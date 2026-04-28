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

use tauri::Manager;

use crate::agents::Registry;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
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
            agents::start(app.handle().clone(), registry);

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
            chat::chat_list_conversations,
            chat::chat_create_conversation,
            chat::chat_get_conversation,
            chat::chat_delete_conversation,
            chat::chat_patch_conversation,
            chat::chat_send_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Agent Hub");
}
