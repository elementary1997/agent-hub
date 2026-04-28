//! Agent registry + HTTP poller.
//!
//! On launch we scan and watch `~/.config/agent-hub/agents/` (or the platform
//! equivalent on Windows). Every JSON file there is parsed as an
//! `AgentManifest` (Protocol v0.1) and added to the in-memory registry.
//! For each agent we spin up a Tokio task that polls `GET <endpoint>/status`
//! every 3 seconds and updates the runtime view; updates are pushed to the
//! frontend via the `agent-upserted` / `agent-removed` Tauri events.
//!
//! Live WebSocket event streams (`/events`) are intentionally deferred —
//! see ROADMAP.md (v0.1.2). Polling is enough to drive a responsive card grid.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use notify::{event::ModifyKind, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::client_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

const POLL_INTERVAL: Duration = Duration::from_secs(3);
const POLL_TIMEOUT: Duration = Duration::from_millis(1500);
const PROTOCOL_VERSION: &str = "0.1";
const WS_BACKOFF_MIN: Duration = Duration::from_secs(2);
const WS_BACKOFF_MAX: Duration = Duration::from_secs(30);

// ─── Types ─────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AgentManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub kind: String,
    pub endpoint: String,
    pub lifecycle: String,
    #[serde(default)]
    pub executable: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub tagline: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub accent: Option<String>,
    #[serde(default)]
    pub ai: Option<serde_json::Value>,
    #[serde(default)]
    pub protocol: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Running,
    Busy,
    Idle,
    Error,
    #[default]
    Offline,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntime {
    pub status: AgentStatus,
    pub busy: bool,
    pub last_event_at: Option<String>,
    pub uptime_sec: u64,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentRecord {
    pub manifest: AgentManifest,
    pub runtime: AgentRuntime,
}

#[derive(Deserialize)]
struct StatusResponse {
    #[serde(default)]
    alive: bool,
    #[serde(default)]
    busy: bool,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    uptime_sec: Option<u64>,
    #[serde(default)]
    last_event: Option<String>,
}

// ─── Registry ──────────────────────────────────────────────────────────────

struct AgentTasks {
    #[allow(dead_code)]
    endpoint: String,
    poll_task: JoinHandle<()>,
    ws_task: JoinHandle<()>,
}

impl Drop for AgentTasks {
    fn drop(&mut self) {
        self.poll_task.abort();
        self.ws_task.abort();
    }
}

pub struct Registry {
    agents: Mutex<HashMap<String, AgentRecord>>,
    tasks: Mutex<HashMap<String, AgentTasks>>,
    http: reqwest::Client,
}

impl Registry {
    pub fn new() -> Arc<Self> {
        let http = reqwest::Client::builder()
            .timeout(POLL_TIMEOUT)
            .build()
            .expect("failed to build reqwest client");
        Arc::new(Self {
            agents: Mutex::new(HashMap::new()),
            tasks: Mutex::new(HashMap::new()),
            http,
        })
    }

    pub async fn snapshot(&self) -> Vec<AgentRecord> {
        let g = self.agents.lock().await;
        let mut v: Vec<AgentRecord> = g.values().cloned().collect();
        v.sort_by(|a, b| a.manifest.name.to_lowercase().cmp(&b.manifest.name.to_lowercase()));
        v
    }

    pub async fn endpoint_of(&self, id: &str) -> Option<String> {
        self.agents
            .lock()
            .await
            .get(id)
            .map(|r| r.manifest.endpoint.clone())
    }

    pub async fn manifest_of(&self, id: &str) -> Option<AgentManifest> {
        self.agents
            .lock()
            .await
            .get(id)
            .map(|r| r.manifest.clone())
    }

    /// Shared reqwest client for chat / SSE / one-off API calls. Reusing the
    /// same connection pool everywhere avoids hammering 127.0.0.1 with
    /// fresh TCP handshakes per request.
    pub fn http_client(&self) -> &reqwest::Client {
        &self.http
    }
}

// ─── Bootstrapping ─────────────────────────────────────────────────────────

/// Spawns the manifest watcher + initial scan. Safe to call once at app setup.
pub fn start(app: AppHandle, registry: Arc<Registry>) {
    let dir = match manifest_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[agents] cannot locate manifest dir: {e}");
            return;
        }
    };

    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[agents] cannot create {}: {e}", dir.display());
        return;
    }

    eprintln!("[agents] watching {}", dir.display());

    let app_for_scan = app.clone();
    let registry_for_scan = registry.clone();
    let dir_for_scan = dir.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = initial_scan(&app_for_scan, &registry_for_scan, &dir_for_scan).await {
            eprintln!("[agents] initial scan failed: {e}");
        }
    });

    let app_for_watch = app.clone();
    let registry_for_watch = registry.clone();
    let dir_for_watch = dir.clone();
    std::thread::spawn(move || {
        if let Err(e) = run_watcher(app_for_watch, registry_for_watch, dir_for_watch) {
            eprintln!("[agents] watcher stopped: {e}");
        }
    });
}

fn manifest_dir() -> Result<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        dirs::config_dir().ok_or_else(|| anyhow!("no APPDATA"))?
    } else {
        dirs::config_dir().ok_or_else(|| anyhow!("no XDG_CONFIG_HOME"))?
    };
    Ok(base.join("agent-hub").join("agents"))
}

async fn initial_scan(app: &AppHandle, registry: &Arc<Registry>, dir: &Path) -> Result<()> {
    let entries = std::fs::read_dir(dir).context("read manifest dir")?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Err(e) = upsert_from_file(app, registry, &p).await {
            eprintln!("[agents] skip {}: {e}", p.display());
        }
    }
    Ok(())
}

fn run_watcher(app: AppHandle, registry: Arc<Registry>, dir: PathBuf) -> Result<()> {
    let (tx, rx) = std::sync::mpsc::channel::<Event>();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| match res {
            Ok(ev) => {
                let _ = tx.send(ev);
            }
            Err(e) => eprintln!("[agents] watch error: {e}"),
        },
        notify::Config::default(),
    )?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;

    while let Ok(event) = rx.recv() {
        let app_clone = app.clone();
        let registry_clone = registry.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = handle_event(&app_clone, &registry_clone, &event).await {
                eprintln!("[agents] event handling failed: {e}");
            }
        });
    }

    drop(watcher);
    Ok(())
}

async fn handle_event(
    app: &AppHandle,
    registry: &Arc<Registry>,
    event: &Event,
) -> Result<()> {
    let interesting = matches!(
        event.kind,
        EventKind::Create(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Any)
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Remove(_)
    );
    if !interesting {
        return Ok(());
    }

    for path in &event.paths {
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if path.exists() {
            if let Err(e) = upsert_from_file(app, registry, path).await {
                eprintln!("[agents] upsert {}: {e}", path.display());
            }
        } else if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            remove(app, registry, stem).await;
        }
    }
    Ok(())
}

async fn upsert_from_file(
    app: &AppHandle,
    registry: &Arc<Registry>,
    path: &Path,
) -> Result<()> {
    let bytes = tokio::fs::read(path).await.context("read manifest")?;
    let manifest: AgentManifest =
        serde_json::from_slice(&bytes).context("parse manifest JSON")?;

    if let Some(p) = &manifest.protocol {
        if !p.starts_with("0.") {
            return Err(anyhow!("unsupported protocol {p} (hub speaks {PROTOCOL_VERSION})"));
        }
    }

    let id = manifest.id.clone();
    let endpoint = manifest.endpoint.clone();

    let prev_endpoint = {
        let mut agents = registry.agents.lock().await;
        let prev = agents.get(&id).map(|r| r.manifest.endpoint.clone());
        let runtime = agents
            .get(&id)
            .map(|r| r.runtime.clone())
            .unwrap_or_default();
        let record = AgentRecord {
            manifest: manifest.clone(),
            runtime,
        };
        agents.insert(id.clone(), record.clone());
        let _ = app.emit("agent-upserted", &record);
        prev
    };

    let need_new_poller = match prev_endpoint {
        Some(prev) => prev != endpoint,
        None => true,
    };

    if need_new_poller {
        spawn_agent_tasks(app.clone(), registry.clone(), id.clone(), endpoint).await;
    }

    Ok(())
}

async fn remove(app: &AppHandle, registry: &Arc<Registry>, id: &str) {
    {
        let mut agents = registry.agents.lock().await;
        if agents.remove(id).is_none() {
            return;
        }
    }
    {
        let mut tasks = registry.tasks.lock().await;
        tasks.remove(id);
    }
    let _ = app.emit("agent-removed", id);
}

// ─── Per-agent tasks (poll + WS) ───────────────────────────────────────────

async fn spawn_agent_tasks(
    app: AppHandle,
    registry: Arc<Registry>,
    id: String,
    endpoint: String,
) {
    let poll_task = {
        let app = app.clone();
        let registry = registry.clone();
        let id = id.clone();
        let endpoint = endpoint.clone();
        tauri::async_runtime::spawn(async move {
            poll_loop(app, registry, id, endpoint).await;
        })
    };

    let ws_task = {
        let app = app.clone();
        let registry = registry.clone();
        let id = id.clone();
        let endpoint = endpoint.clone();
        tauri::async_runtime::spawn(async move {
            ws_loop(app, registry, id, endpoint).await;
        })
    };

    let mut tasks = registry.tasks.lock().await;
    tasks.insert(
        id,
        AgentTasks {
            endpoint,
            poll_task,
            ws_task,
        },
    );
}

async fn poll_loop(
    app: AppHandle,
    registry: Arc<Registry>,
    id: String,
    endpoint: String,
) {
    let url = format!("{}/status", endpoint.trim_end_matches('/'));
    let mut interval = tokio::time::interval(POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    interval.tick().await; // fire immediately

    loop {
        let outcome = registry.http.get(&url).send().await;

        let (status, busy, runtime_partial) = match outcome {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<StatusResponse>().await {
                    Ok(s) if s.alive => {
                        let kind = if s.busy { AgentStatus::Busy } else { AgentStatus::Running };
                        (
                            kind,
                            s.busy,
                            Some((s.version, s.uptime_sec.unwrap_or(0), s.last_event)),
                        )
                    }
                    Ok(_) => (AgentStatus::Idle, false, None),
                    Err(_) => (AgentStatus::Error, false, None),
                }
            }
            Ok(resp) => {
                let msg = format!("HTTP {}", resp.status());
                update_runtime(&app, &registry, &id, AgentStatus::Error, false, None, Some(msg)).await;
                interval.tick().await;
                continue;
            }
            Err(_) => {
                update_runtime(
                    &app,
                    &registry,
                    &id,
                    AgentStatus::Offline,
                    false,
                    None,
                    None,
                )
                .await;
                interval.tick().await;
                continue;
            }
        };

        let (version, uptime, last_event) = runtime_partial.unwrap_or((None, 0, None));
        update_runtime(&app, &registry, &id, status, busy, Some((version, uptime, last_event)), None).await;

        interval.tick().await;
    }
}

// ─── WebSocket /events client ──────────────────────────────────────────────

#[derive(Deserialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    data: serde_json::Value,
}

async fn ws_loop(
    app: AppHandle,
    registry: Arc<Registry>,
    id: String,
    endpoint: String,
) {
    let ws_url = endpoint
        .replacen("http://", "ws://", 1)
        .replacen("https://", "wss://", 1)
        .trim_end_matches('/')
        .to_string()
        + "/events";

    let mut backoff = WS_BACKOFF_MIN;
    loop {
        match try_run_ws(&app, &registry, &id, &endpoint, &ws_url).await {
            Ok(()) => {
                eprintln!("[agents] ws closed by peer: {id}");
                backoff = WS_BACKOFF_MIN;
            }
            Err(e) => {
                eprintln!("[agents] ws {id} failed: {e}");
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(WS_BACKOFF_MAX);
    }
}

async fn try_run_ws(
    app: &AppHandle,
    registry: &Arc<Registry>,
    id: &str,
    endpoint: &str,
    ws_url: &str,
) -> Result<()> {
    let (host, port) = parse_host_port(endpoint)
        .ok_or_else(|| anyhow!("cannot parse endpoint {endpoint}"))?;
    let stream = TcpStream::connect((host.as_str(), port))
        .await
        .with_context(|| format!("tcp connect {host}:{port}"))?;
    let request = ws_url
        .into_client_request()
        .with_context(|| format!("invalid ws url {ws_url}"))?;
    let (mut ws, _resp) = client_async(request, stream)
        .await
        .with_context(|| format!("ws handshake {ws_url}"))?;

    while let Some(frame) = ws.next().await {
        let frame = frame.context("ws read")?;
        match frame {
            Message::Text(t) => dispatch_ws_event(app, registry, id, &t).await,
            Message::Binary(b) => {
                if let Ok(t) = std::str::from_utf8(&b) {
                    dispatch_ws_event(app, registry, id, t).await;
                }
            }
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
            Message::Close(_) => break,
        }
    }
    Ok(())
}

async fn dispatch_ws_event(
    app: &AppHandle,
    registry: &Arc<Registry>,
    id: &str,
    raw: &str,
) {
    let envelope: WsEnvelope = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[agents] ws {id}: bad json: {e}");
            return;
        }
    };

    match envelope.kind.as_str() {
        "agent_busy" => {
            let busy = envelope
                .data
                .get("busy")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let reason = envelope
                .data
                .get("reason")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            apply_busy(app, registry, id, busy, reason).await;
        }
        "error" => {
            let msg = envelope
                .data
                .get("message")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            apply_error(app, registry, id, msg).await;
        }
        // hello / heartbeat / log / usage_update / tool_called / transcript_*
        // pass through to the UI feed without touching runtime state.
        _ => {}
    }

    let _ = app.emit(
        "agent-event",
        json!({
            "agentId": id,
            "type": envelope.kind,
            "data": envelope.data,
        }),
    );
}

async fn apply_busy(
    app: &AppHandle,
    registry: &Arc<Registry>,
    id: &str,
    busy: bool,
    reason: Option<String>,
) {
    let mut agents = registry.agents.lock().await;
    let Some(record) = agents.get_mut(id) else {
        return;
    };
    record.runtime.busy = busy;
    record.runtime.status = if busy {
        AgentStatus::Busy
    } else {
        match record.runtime.status {
            // Fall back to Running unless poller has marked us offline / errored.
            AgentStatus::Busy | AgentStatus::Idle => AgentStatus::Running,
            other => other,
        }
    };
    record.runtime.message = if busy { reason } else { None };
    let snapshot = record.clone();
    drop(agents);
    let _ = app.emit("agent-upserted", &snapshot);
}

async fn apply_error(app: &AppHandle, registry: &Arc<Registry>, id: &str, message: Option<String>) {
    let mut agents = registry.agents.lock().await;
    let Some(record) = agents.get_mut(id) else {
        return;
    };
    record.runtime.status = AgentStatus::Error;
    record.runtime.busy = false;
    record.runtime.message = message;
    let snapshot = record.clone();
    drop(agents);
    let _ = app.emit("agent-upserted", &snapshot);
}

/// Parses `http://host:port[/...]` → `(host, port)`. Local-only — the protocol
/// guarantees `127.0.0.1`/`localhost` endpoints, so we keep it dependency-free.
fn parse_host_port(endpoint: &str) -> Option<(String, u16)> {
    let stripped = endpoint
        .strip_prefix("http://")
        .or_else(|| endpoint.strip_prefix("https://"))
        .or_else(|| endpoint.strip_prefix("ws://"))
        .or_else(|| endpoint.strip_prefix("wss://"))?;
    let host_port = stripped.split('/').next()?;
    let (host, port) = host_port.rsplit_once(':')?;
    let port = port.parse().ok()?;
    Some((host.to_string(), port))
}

// ─── Runtime helpers ───────────────────────────────────────────────────────

#[allow(clippy::type_complexity)]
async fn update_runtime(
    app: &AppHandle,
    registry: &Arc<Registry>,
    id: &str,
    status: AgentStatus,
    busy: bool,
    fields: Option<(Option<String>, u64, Option<String>)>,
    message: Option<String>,
) {
    let mut agents = registry.agents.lock().await;
    let Some(record) = agents.get_mut(id) else {
        return;
    };

    record.runtime.status = status;
    record.runtime.busy = busy;
    record.runtime.message = message;

    if let Some((version, uptime, last_event)) = fields {
        record.runtime.uptime_sec = uptime;
        record.runtime.last_event_at = last_event;
        if let Some(v) = version {
            if !v.is_empty() {
                record.manifest.version = v;
            }
        }
    }

    let snapshot = record.clone();
    drop(agents);
    let _ = app.emit("agent-upserted", &snapshot);
}

// ─── Tauri commands (called from frontend) ─────────────────────────────────

#[tauri::command]
pub async fn list_agents(
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<Vec<AgentRecord>, String> {
    Ok(registry.snapshot().await)
}

#[tauri::command]
pub async fn agent_open_native(
    id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let endpoint = registry
        .endpoint_of(&id)
        .await
        .ok_or_else(|| format!("unknown agent {id}"))?;
    let url = format!("{}/open-native-ui", endpoint.trim_end_matches('/'));
    registry
        .http
        .post(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn agent_quit(
    id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let endpoint = registry
        .endpoint_of(&id)
        .await
        .ok_or_else(|| format!("unknown agent {id}"))?;
    let url = format!("{}/quit", endpoint.trim_end_matches('/'));
    registry
        .http
        .post(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn agents_dir() -> Result<String, String> {
    manifest_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}
