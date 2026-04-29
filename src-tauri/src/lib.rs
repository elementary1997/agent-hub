//! Agent Hub Rust core (v0.1.1).
//!
//! - Manifest registry + filesystem watcher (`agents` module).
//! - HTTP poller per agent (`/status` every 3s, results pushed to the
//!   frontend via `agent-upserted` / `agent-removed` events).
//! - Tauri commands: `list_agents`, `agent_open_native`, `agent_quit`,
//!   `agents_dir`, `ping`.
//!
//! WebSocket event streams (`/events`) and the managed-agent process
//! supervisor land in v0.1.2 / v0.3 — see ROADMAP.md.

mod agents;
mod chat;
mod chatdb;
mod cloudru_agent;
mod easystt_install;
mod npm_util;
mod openrouter_agent;
mod prefs;
mod supervisor;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use std::str::FromStr;
use std::sync::{Arc, Mutex};

use crate::agents::Registry;
use crate::chatdb::ChatDb;
use crate::supervisor::Supervisor;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

fn focus_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[derive(Clone)]
struct RegisteredHotkeys {
    show_hub: Shortcut,
    new_chat: Shortcut,
}

impl Default for RegisteredHotkeys {
    fn default() -> Self {
        Self {
            show_hub: Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyH),
            new_chat: Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN),
        }
    }
}

fn parse_shortcut(raw: &str, fallback: Shortcut) -> Shortcut {
    Shortcut::from_str(raw).unwrap_or(fallback)
}

fn apply_hotkeys(app: &tauri::AppHandle, prefs: prefs::HotkeyPrefs) -> Result<(), String> {
    let show = parse_shortcut(
        &prefs.show_hub,
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyH),
    );
    let chat = parse_shortcut(
        &prefs.new_chat,
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN),
    );
    if show == chat {
        return Err("Hotkeys must be different".to_string());
    }

    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;
    app.global_shortcut().register(show).map_err(|e| e.to_string())?;
    app.global_shortcut().register(chat).map_err(|e| e.to_string())?;

    if let Some(state) = app.try_state::<Mutex<RegisteredHotkeys>>() {
        if let Ok(mut guard) = state.lock() {
            *guard = RegisteredHotkeys {
                show_hub: show,
                new_chat: chat,
            };
        }
    }
    Ok(())
}

#[tauri::command]
async fn hotkeys_set(app: tauri::AppHandle, prefs: prefs::HotkeyPrefs) -> Result<(), String> {
    apply_hotkeys(&app, prefs.clone())?;
    prefs::set_hotkey_prefs(&app, &prefs)?;
    let _ = app.emit("hotkeys-updated", &prefs);
    Ok(())
}

#[tauri::command]
async fn updater_check_and_install(app: tauri::AppHandle) -> Result<String, String> {
    let pubkey = prefs::get_updater_prefs(&app).pubkey;
    let mut builder = app.updater_builder();
    if !pubkey.trim().is_empty() {
        builder = builder.pubkey(pubkey.trim().to_string());
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    if let Some(update) = update {
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        Ok("installed".to_string())
    } else {
        Ok("none".to_string())
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let Some(state) = app.try_state::<Mutex<RegisteredHotkeys>>() else {
                            return;
                        };
                        let Ok(guard) = state.lock() else {
                            return;
                        };
                        if shortcut == &guard.show_hub {
                            focus_main(app);
                        } else if shortcut == &guard.new_chat {
                            focus_main(app);
                            let _ = app.emit("hotkey-new-chat", ());
                        }
                    }
                })
                .build(),
        )
        .setup(move |app| {
            app.manage(Mutex::new(RegisteredHotkeys::default()));
            let prefs = prefs::get_hotkey_prefs(&app.handle());
            if let Err(e) = apply_hotkeys(&app.handle(), prefs) {
                eprintln!("[hotkey] failed to register configured hotkeys: {e}");
            }
            let registry = Registry::new();
            app.manage(registry.clone());

            let supervisor = Supervisor::new(app.handle().clone(), registry.clone());
            app.manage(supervisor);

            // Local chat history cache. Failure to open the DB is non-fatal:
            // the hub falls back to live-only mode (UI sees only what the
            // current agent reports), which is exactly the pre-v0.2.1
            // behaviour.
            let db_path = app
                .path()
                .app_data_dir()
                .map(|d| d.join("chat.db"))
                .unwrap_or_else(|_| std::path::PathBuf::from("chat.db"));
            match ChatDb::open(db_path) {
                Ok(db) => {
                    app.manage(Arc::new(db));
                }
                Err(e) => eprintln!("[chatdb] disabled — open failed: {e:#}"),
            }

            agents::start(app.handle().clone(), registry);

            // System tray quick actions.
            let status = MenuItem::with_id(
                app,
                "tray_status",
                "Status: Agent Hub ready",
                false,
                None::<&str>,
            )?;
            let show = MenuItem::with_id(app, "tray_show", "Show Agent Hub", true, None::<&str>)?;
            let new_chat =
                MenuItem::with_id(app, "tray_new_chat", "New chat (last AI)", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status, &show, &new_chat, &quit])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("missing default window icon"))?;

            let _tray = TrayIconBuilder::with_id("main")
                .icon(icon)
                .tooltip("Agent Hub")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray_show" => focus_main(app),
                    "tray_new_chat" => {
                        focus_main(app);
                        let _ = app.emit("tray-new-chat", ());
                    }
                    "tray_quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        focus_main(tray.app_handle());
                    }
                })
                .build(app)?;

            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            agents::list_agents,
            agents::agent_open_native,
            agents::agent_quit,
            agents::agents_dir,
            agents::agent_get_config,
            agents::agent_put_config,
            chat::chat_list_conversations,
            chat::chat_create_conversation,
            chat::chat_get_conversation,
            chat::chat_delete_conversation,
            chat::chat_patch_conversation,
            chat::chat_send_message,
            chat::chat_store_attachment,
            chat::chat_export_conversation,
            chat::chat_search,
            chat::chat_db_stats,
            supervisor::agent_start,
            supervisor::agent_stop_managed,
            supervisor::agent_logs,
            supervisor::agent_is_managed_running,
            supervisor::agent_uninstall_local,
            prefs::agent_get_auto_start,
            prefs::agent_set_auto_start,
            prefs::hotkeys_get,
            hotkeys_set,
            prefs::updater_prefs_get,
            prefs::updater_prefs_set,
            updater_check_and_install,
            openrouter_agent::install_openrouter_agent,
            cloudru_agent::install_cloudru_agent,
            easystt_install::install_easystt_latest,
            easystt_install::easystt_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Agent Hub");
}
