//! User-level overrides for per-agent behaviour.
//!
//! Currently a single bit per agent: should the hub auto-start it when the
//! hub itself starts? The default falls back to the manifest's
//! `auto_start_on_hub_launch` field; the user toggle in the UI overrides
//! that and is persisted in `tauri-plugin-store`.

use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

use crate::agents::{AgentManifest, Registry};
use crate::supervisor::Supervisor;

const STORE_FILE: &str = "agent-hub.json";
const KEY_HOTKEY_SHOW_HUB: &str = "hotkey.show_hub";
const KEY_HOTKEY_NEW_CHAT: &str = "hotkey.new_chat";
const KEY_UPDATER_PUBKEY: &str = "updater.pubkey";
pub const DEFAULT_HOTKEY_SHOW_HUB: &str = "Ctrl+Shift+H";
pub const DEFAULT_HOTKEY_NEW_CHAT: &str = "Ctrl+Shift+N";

fn key_auto_start(id: &str) -> String {
    format!("agent.{id}.auto_start")
}

/// `Some(true)` / `Some(false)` means the user explicitly toggled it;
/// `None` means "no override — fall back to the manifest default".
pub fn user_auto_start_override(app: &AppHandle, id: &str) -> Option<bool> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(key_auto_start(id))?;
    value.as_bool()
}

/// Effective auto-start for an agent: user override > manifest default > false.
pub fn effective_auto_start(app: &AppHandle, manifest: &AgentManifest) -> bool {
    if let Some(o) = user_auto_start_override(app, &manifest.id) {
        return o;
    }
    manifest.auto_start_on_hub_launch.unwrap_or(false)
}

pub fn set_auto_start(app: &AppHandle, id: &str, enabled: bool) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(key_auto_start(id), Value::Bool(enabled));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HotkeyPrefs {
    pub show_hub: String,
    pub new_chat: String,
}

pub fn get_hotkey_prefs(app: &AppHandle) -> HotkeyPrefs {
    let store = app.store(STORE_FILE).ok();
    let show_hub = store
        .as_ref()
        .and_then(|s| s.get(KEY_HOTKEY_SHOW_HUB))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| DEFAULT_HOTKEY_SHOW_HUB.to_string());
    let new_chat = store
        .as_ref()
        .and_then(|s| s.get(KEY_HOTKEY_NEW_CHAT))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| DEFAULT_HOTKEY_NEW_CHAT.to_string());
    HotkeyPrefs { show_hub, new_chat }
}

pub fn set_hotkey_prefs(app: &AppHandle, prefs: &HotkeyPrefs) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(
        KEY_HOTKEY_SHOW_HUB,
        Value::String(prefs.show_hub.trim().to_string()),
    );
    store.set(
        KEY_HOTKEY_NEW_CHAT,
        Value::String(prefs.new_chat.trim().to_string()),
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UpdaterPrefs {
    pub pubkey: String,
}

pub fn get_updater_prefs(app: &AppHandle) -> UpdaterPrefs {
    let store = app.store(STORE_FILE).ok();
    let pubkey = store
        .as_ref()
        .and_then(|s| s.get(KEY_UPDATER_PUBKEY))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    UpdaterPrefs { pubkey }
}

pub fn set_updater_prefs(app: &AppHandle, prefs: &UpdaterPrefs) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(
        KEY_UPDATER_PUBKEY,
        Value::String(prefs.pubkey.trim().to_string()),
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn hotkeys_get(app: AppHandle) -> Result<HotkeyPrefs, String> {
    Ok(get_hotkey_prefs(&app))
}

#[tauri::command]
pub async fn updater_prefs_get(app: AppHandle) -> Result<UpdaterPrefs, String> {
    Ok(get_updater_prefs(&app))
}

#[tauri::command]
pub async fn updater_prefs_set(app: AppHandle, prefs: UpdaterPrefs) -> Result<(), String> {
    set_updater_prefs(&app, &prefs)
}

/// If the manifest is a managed agent and the user asked us to auto-start it,
/// fire-and-forget the supervisor. Idempotent — `Supervisor::start` is a
/// no-op when the agent is already running.
pub fn maybe_autostart(app: &AppHandle, manifest: &AgentManifest) {
    if manifest.lifecycle != "managed" || manifest.executable.is_none() {
        return;
    }
    if !effective_auto_start(app, manifest) {
        return;
    }
    let app = app.clone();
    let id = manifest.id.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(supervisor) = app.try_state::<Arc<Supervisor>>() {
            if let Err(e) = supervisor.start(&id).await {
                eprintln!("[prefs] autostart {id} failed: {e}");
            }
        }
    });
}

#[derive(serde::Serialize)]
pub struct AutoStartView {
    pub enabled: bool,
    pub user_override: Option<bool>,
    pub manifest_default: bool,
}

#[tauri::command]
pub async fn agent_get_auto_start(
    app: AppHandle,
    id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<AutoStartView, String> {
    let manifest_default = registry
        .manifest_of(&id)
        .await
        .and_then(|m| m.auto_start_on_hub_launch)
        .unwrap_or(false);
    let user_override = user_auto_start_override(&app, &id);
    Ok(AutoStartView {
        enabled: user_override.unwrap_or(manifest_default),
        user_override,
        manifest_default,
    })
}

#[tauri::command]
pub async fn agent_set_auto_start(
    app: AppHandle,
    id: String,
    enabled: bool,
    registry: tauri::State<'_, Arc<Registry>>,
    supervisor: tauri::State<'_, Arc<Supervisor>>,
) -> Result<(), String> {
    set_auto_start(&app, &id, enabled)?;
    if enabled {
        // Honour the toggle immediately — but only for managed agents we
        // actually own; standalone agents are run by the user.
        if let Some(manifest) = registry.manifest_of(&id).await {
            if manifest.lifecycle == "managed" {
                let _ = supervisor.start(&id).await;
            }
        }
    }
    Ok(())
}
