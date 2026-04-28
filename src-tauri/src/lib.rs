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
mod prefs;
mod supervisor;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

use crate::agents::Registry;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let registry = Registry::new();
            app.manage(registry.clone());

            let supervisor = Supervisor::new(app.handle().clone(), registry.clone());
            app.manage(supervisor);

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
            supervisor::agent_start,
            supervisor::agent_stop_managed,
            supervisor::agent_logs,
            supervisor::agent_is_managed_running,
            prefs::agent_get_auto_start,
            prefs::agent_set_auto_start,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Agent Hub");
}
