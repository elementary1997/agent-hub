//! Process supervisor for `lifecycle: "managed"` agents.
//!
//! Spawns the executable declared in the manifest, mirrors stdout/stderr into
//! a per-agent ring buffer, and restarts the process on unexpected exit using
//! a small budget (max 3 attempts per 60 s window). Graceful stop tries
//! `POST /quit` first, then falls back to a kill on the child handle.
//!
//! State lives inside `Supervisor`; commands like `agent_start` /
//! `agent_stop_managed` / `agent_logs` operate against it via Tauri's
//! managed state.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::agents::{AgentManifest, Registry};

const LOG_RING_CAPACITY: usize = 1000;
const RESTART_WINDOW: Duration = Duration::from_secs(60);
const RESTART_LIMIT: u32 = 3;
const STOP_GRACE: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Serialize)]
pub struct LogLine {
    pub at: u128,            // unix millis
    pub stream: &'static str, // "stdout" | "stderr" | "supervisor"
    pub text: String,
}

/// Cheap, lock-friendly ring buffer for log tails.
#[derive(Default)]
struct LogBuffer {
    lines: VecDeque<LogLine>,
}

impl LogBuffer {
    fn push(&mut self, line: LogLine) {
        if self.lines.len() == LOG_RING_CAPACITY {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }
    fn snapshot(&self) -> Vec<LogLine> {
        self.lines.iter().cloned().collect()
    }
}

/// Tracks restarts inside a sliding 60-second window.
#[derive(Default)]
struct RestartBudget {
    attempts: u32,
    window_start: Option<Instant>,
}

impl RestartBudget {
    fn record(&mut self) -> bool {
        let now = Instant::now();
        match self.window_start {
            Some(t) if now.duration_since(t) < RESTART_WINDOW => {
                self.attempts += 1;
            }
            _ => {
                self.attempts = 1;
                self.window_start = Some(now);
            }
        }
        self.attempts <= RESTART_LIMIT
    }
}

struct ProcessSlot {
    /// Outer supervisor loop — owns the spawn → wait → maybe-restart cycle.
    /// Aborted on `Drop` (Tauri shutdown) so background tasks don't leak.
    supervisor_task: JoinHandle<()>,
    /// Held so we can kill non-cooperative children from `stop()`.
    child: Arc<Mutex<Option<Child>>>,
    logs: Arc<Mutex<LogBuffer>>,
    /// Flipped by `stop()` so the supervisor loop knows the exit is intentional.
    intentional_exit: Arc<Mutex<bool>>,
}

impl Drop for ProcessSlot {
    fn drop(&mut self) {
        self.supervisor_task.abort();
    }
}

pub struct Supervisor {
    slots: Mutex<HashMap<String, ProcessSlot>>,
    registry: Arc<Registry>,
    app: AppHandle,
}

impl Supervisor {
    pub fn new(app: AppHandle, registry: Arc<Registry>) -> Arc<Self> {
        Arc::new(Self {
            slots: Mutex::new(HashMap::new()),
            registry,
            app,
        })
    }

    pub async fn is_running(&self, id: &str) -> bool {
        self.slots.lock().await.contains_key(id)
    }

    /// Looks the manifest up in the registry and starts the supervisor loop
    /// for it. No-op if already running.
    pub async fn start(self: &Arc<Self>, id: &str) -> Result<()> {
        if self.is_running(id).await {
            return Ok(());
        }
        let manifest = self
            .registry
            .manifest_of(id)
            .await
            .ok_or_else(|| anyhow!("unknown agent {id}"))?;
        if manifest.lifecycle != "managed" {
            return Err(anyhow!("agent {id} is standalone — hub does not own its lifecycle"));
        }
        if manifest.executable.is_none() {
            return Err(anyhow!("manifest {id} missing `executable`"));
        }

        let logs = Arc::new(Mutex::new(LogBuffer::default()));
        let intentional_exit = Arc::new(Mutex::new(false));
        let child_arc: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));

        let supervisor_task = {
            let supervisor = self.clone();
            let id = id.to_string();
            let logs = logs.clone();
            let intentional_exit = intentional_exit.clone();
            let child_arc = child_arc.clone();
            tauri::async_runtime::spawn(async move {
                supervisor
                    .supervisor_loop(id, logs, intentional_exit, child_arc)
                    .await;
            })
        };

        self.slots.lock().await.insert(
            id.to_string(),
            ProcessSlot {
                supervisor_task,
                child: child_arc,
                logs,
                intentional_exit,
            },
        );
        Ok(())
    }

    /// POST /quit, wait for grace, kill if it doesn't bow out.
    pub async fn stop(&self, id: &str) -> Result<()> {
        let endpoint = self.registry.endpoint_of(id).await;

        let slot = {
            let slots = self.slots.lock().await;
            slots
                .get(id)
                .map(|s| (s.child.clone(), s.intentional_exit.clone()))
        };

        let Some((child, intentional)) = slot else {
            // Slot missing but process may still be alive — still ask the agent to quit.
            if let Some(ep) = endpoint {
                let url = format!("{}/quit", ep.trim_end_matches('/'));
                let _ = self
                    .registry
                    .http_client()
                    .post(url)
                    .timeout(Duration::from_secs(15))
                    .send()
                    .await;
            }
            return Ok(());
        };

        *intentional.lock().await = true;

        // Try graceful first — agents implement POST /quit per protocol §2.
        if let Some(ep) = endpoint {
            let url = format!("{}/quit", ep.trim_end_matches('/'));
            let _ = self
                .registry
                .http_client()
                .post(url)
                .timeout(Duration::from_secs(15))
                .send()
                .await;
        }

        // While `supervisor_loop` calls `take()` on the child for blocking `wait()`, the mutex
        // is empty — don't exit immediately; wait STOP_GRACE so /quit + exit can complete.
        let kill_after = Instant::now() + STOP_GRACE;
        loop {
            {
                let mut guard = child.lock().await;
                if let Some(c) = guard.as_mut() {
                    match c.try_wait() {
                        Ok(Some(_)) => {
                            *guard = None;
                            break;
                        }
                        Ok(None) if Instant::now() >= kill_after => {
                            let _ = c.kill().await;
                            *guard = None;
                            break;
                        }
                        Ok(None) => {}
                        Err(_) => {
                            *guard = None;
                            break;
                        }
                    }
                } else if Instant::now() >= kill_after {
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }

        self.slots.lock().await.remove(id);
        self.push_supervisor_log(id, "stopped by user").await;
        Ok(())
    }

    pub async fn logs(&self, id: &str) -> Vec<LogLine> {
        let slots = self.slots.lock().await;
        match slots.get(id) {
            Some(s) => s.logs.lock().await.snapshot(),
            None => Vec::new(),
        }
    }

    async fn push_supervisor_log(&self, id: &str, text: &str) {
        let line = LogLine {
            at: now_millis(),
            stream: "supervisor",
            text: text.to_string(),
        };
        if let Some(s) = self.slots.lock().await.get(id) {
            s.logs.lock().await.push(line.clone());
        }
        let _ = self.app.emit(
            "agent-log",
            serde_json::json!({ "agentId": id, "line": line }),
        );
    }

    /// Long-running supervisor: spawn → wait → maybe-restart with a budget.
    /// Lives until either an intentional stop or three crashes in 60 s.
    async fn supervisor_loop(
        self: Arc<Self>,
        id: String,
        logs: Arc<Mutex<LogBuffer>>,
        intentional_exit: Arc<Mutex<bool>>,
        child_arc: Arc<Mutex<Option<Child>>>,
    ) {
        let mut budget = RestartBudget::default();
        loop {
            let manifest = match self.registry.manifest_of(&id).await {
                Some(m) => m,
                None => {
                    self.push_supervisor_log(&id, "manifest disappeared — giving up").await;
                    break;
                }
            };

            match spawn_one(&self.app, &manifest, &logs, &child_arc).await {
                Ok(()) => {}
                Err(e) => {
                    self.push_supervisor_log(&id, &format!("spawn failed: {e}")).await;
                    break;
                }
            }

            // Wait for the child to exit. We take ownership locally so we
            // don't hold the slot's mutex through .await.
            let mut child_owned = child_arc.lock().await.take();
            let status = if let Some(ref mut c) = child_owned {
                c.wait().await.ok()
            } else {
                None
            };
            drop(child_owned);

            let was_intentional = *intentional_exit.lock().await;
            let exit_msg = match &status {
                Some(s) if s.success() => "process exited cleanly".to_string(),
                Some(s) => format!("process exited with {s}"),
                None => "process exited (status unavailable)".to_string(),
            };
            self.push_supervisor_log(&id, &exit_msg).await;

            if was_intentional {
                break;
            }
            if !budget.record() {
                self.push_supervisor_log(
                    &id,
                    "restart budget exhausted (3 in 60 s) — giving up",
                )
                .await;
                break;
            }
            self.push_supervisor_log(&id, "restarting after crash…").await;
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        // Drop the slot so a future `start()` call can re-arm the loop.
        self.slots.lock().await.remove(&id);
    }
}

/// Pure spawn helper — no Self reference, so the supervisor loop stays simple.
async fn spawn_one(
    app: &AppHandle,
    manifest: &AgentManifest,
    logs: &Arc<Mutex<LogBuffer>>,
    child_arc: &Arc<Mutex<Option<Child>>>,
) -> Result<()> {
    let executable = manifest
        .executable
        .clone()
        .ok_or_else(|| anyhow!("missing `executable`"))?;
    let args = manifest.args.clone().unwrap_or_default();

    let mut command = Command::new(&executable);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .kill_on_drop(true);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .with_context(|| format!("spawn `{executable} {}`", args.join(" ")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let pid = child.id();

    if let Some(out) = stdout {
        spawn_reader(app.clone(), manifest.id.clone(), logs.clone(), out, "stdout");
    }
    if let Some(err) = stderr {
        spawn_reader(app.clone(), manifest.id.clone(), logs.clone(), err, "stderr");
    }

    *child_arc.lock().await = Some(child);

    let line = LogLine {
        at: now_millis(),
        stream: "supervisor",
        text: format!(
            "spawned {executable} (pid {}) with {} arg(s)",
            pid.map(|p| p.to_string()).unwrap_or_else(|| "?".into()),
            args.len()
        ),
    };
    logs.lock().await.push(line.clone());
    let _ = app.emit(
        "agent-log",
        serde_json::json!({ "agentId": manifest.id, "line": line }),
    );
    Ok(())
}

fn spawn_reader<R>(
    app: AppHandle,
    agent_id: String,
    logs: Arc<Mutex<LogBuffer>>,
    reader: R,
    stream: &'static str,
) where
    R: tokio::io::AsyncRead + Send + Unpin + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut br = BufReader::new(reader).lines();
        while let Ok(Some(line)) = br.next_line().await {
            let entry = LogLine {
                at: now_millis(),
                stream,
                text: line,
            };
            logs.lock().await.push(entry.clone());
            let _ = app.emit(
                "agent-log",
                serde_json::json!({ "agentId": agent_id, "line": entry }),
            );
        }
    });
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ─── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_start(
    id: String,
    supervisor: tauri::State<'_, Arc<Supervisor>>,
) -> Result<(), String> {
    supervisor.start(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_stop_managed(
    id: String,
    supervisor: tauri::State<'_, Arc<Supervisor>>,
) -> Result<(), String> {
    supervisor.stop(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_logs(
    id: String,
    supervisor: tauri::State<'_, Arc<Supervisor>>,
) -> Result<Vec<LogLine>, String> {
    Ok(supervisor.logs(&id).await)
}

#[tauri::command]
pub async fn agent_is_managed_running(
    id: String,
    supervisor: tauri::State<'_, Arc<Supervisor>>,
) -> Result<bool, String> {
    Ok(supervisor.is_running(&id).await)
}

/// Removes the agent manifest from disk and deletes bundled install dirs for
/// marketplace-installed agents (`openrouter-agent`, `cloudru-agent`). Does not
/// alter the in-app Marketplace catalog.
#[tauri::command]
pub async fn agent_uninstall_local(
    id: String,
    supervisor: tauri::State<'_, Arc<Supervisor>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let _ = supervisor.stop(&id).await;

    let manifest = hub_manifest_json_path(&id)?;
    if manifest.exists() {
        std::fs::remove_file(&manifest).map_err(|e| e.to_string())?;
    }

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    for sub in ["openrouter-agent", "cloudru-agent"] {
        if sub == id.as_str() {
            let dir = app_data.join(sub);
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
            }
            break;
        }
    }
    Ok(())
}

fn hub_manifest_json_path(id: &str) -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "cannot resolve config dir".to_string())?;
    Ok(base.join("agent-hub").join("agents").join(format!("{id}.json")))
}
