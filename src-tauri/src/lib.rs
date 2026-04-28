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
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use std::sync::Arc;

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

pub fn run() {
    let show_hub_shortcut =
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyH);
    let shortcut_for_handler = show_hub_shortcut;
    let shortcut_for_setup = show_hub_shortcut;

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &shortcut_for_handler
                        && event.state() == ShortcutState::Pressed
                    {
                        focus_main(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            // Best-effort: registration can fail if another app already owns
            // the combo. We log and keep going so the rest of the hub still
            // boots.
            if let Err(e) = app.global_shortcut().register(shortcut_for_setup) {
                eprintln!("[hotkey] failed to register Ctrl+Shift+H: {e}");
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

            // System tray with a tiny menu — left-click brings the window
            // back, right-click shows Show / Quit.
            let show = MenuItem::with_id(app, "tray_show", "Show Agent Hub", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

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
            chat::chat_search,
            chat::chat_db_stats,
            supervisor::agent_start,
            supervisor::agent_stop_managed,
            supervisor::agent_logs,
            supervisor::agent_is_managed_running,
            prefs::agent_get_auto_start,
            prefs::agent_set_auto_start,
            openrouter_agent::install_openrouter_agent,
            cloudru_agent::install_cloudru_agent,
            easystt_install::install_easystt_latest,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Agent Hub");
}
