//! AI-conversation client.
//!
//! Wraps the agent's HTTP API (`/conversations`, `/conversations/{id}/messages`)
//! exposed by `kind: "ai"` agents (Protocol v0.1 §4). The hub speaks raw JSON
//! over reqwest for CRUD and streams `text/event-stream` for assistant deltas.
//!
//! Each `chat_send_message` invocation gets a `request_id`; every SSE frame
//! is forwarded to the frontend as a `chat-stream` Tauri event so multiple
//! conversations can be in flight without client-side bookkeeping.

use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::agents::Registry;
use crate::chatdb::{ChatDb, SearchHit};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ChatConversation {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub message_count: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: Value,
    #[serde(default)]
    pub at: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateConversation {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
}

#[derive(Deserialize)]
pub struct PatchConversation {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
}

#[derive(Deserialize)]
pub struct SendMessageBody {
    pub content: Value,
    #[serde(default)]
    pub model: Option<String>,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async fn endpoint_for(registry: &Arc<Registry>, agent_id: &str) -> Result<String, String> {
    registry
        .endpoint_of(agent_id)
        .await
        .ok_or_else(|| format!("unknown agent {agent_id}"))
        .map(|e| e.trim_end_matches('/').to_string())
}

async fn json_request<T: serde::de::DeserializeOwned>(
    registry: &Arc<Registry>,
    method: reqwest::Method,
    url: String,
    body: Option<&Value>,
) -> Result<T, String> {
    let mut req = registry.http_client().request(method, &url);
    if let Some(b) = body {
        req = req.json(b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("{status}: {text}"));
    }
    resp.json::<T>().await.map_err(|e| e.to_string())
}

// ─── Tauri commands: CRUD ──────────────────────────────────────────────────
//
// All CRUD endpoints are *write-through*: they hit the agent first, and on
// success replicate the change into the local SQLite cache. Reads prefer the
// agent's view (it is canonical for whatever it remembers), but augment it
// with whatever messages we have cached locally so the UI never loses
// history when an agent forgets / restarts / gets reinstalled.

fn db_of(app: &AppHandle) -> Option<Arc<ChatDb>> {
    app.try_state::<Arc<ChatDb>>().map(|s| s.inner().clone())
}

#[tauri::command]
pub async fn chat_list_conversations(
    app: AppHandle,
    agent_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<Vec<ChatConversation>, String> {
    let endpoint = endpoint_for(&registry, &agent_id).await?;
    let live = json_request::<Vec<ChatConversation>>(
        &registry,
        reqwest::Method::GET,
        format!("{endpoint}/conversations"),
        None,
    )
    .await;

    if let Some(db) = db_of(&app) {
        match live {
            Ok(remote) => {
                // Mirror the live list into the cache so future offline opens
                // see the same conversations. We do NOT delete cached convs
                // that the agent forgot — the hub owns those by design.
                for c in &remote {
                    let _ = db.upsert_conversation(
                        &agent_id,
                        &c.id,
                        c.title.as_deref(),
                        c.system_prompt.as_deref(),
                    );
                }
                Ok(remote)
            }
            Err(_) => {
                // Offline / agent down: fall back to whatever we cached.
                let cached = db.list_conversations(&agent_id).map_err(|e| e.to_string())?;
                Ok(cached
                    .into_iter()
                    .map(|c| ChatConversation {
                        id: c.id,
                        title: c.title,
                        system_prompt: c.system_prompt,
                        messages: Vec::new(),
                        updated_at: Some(c.updated_at),
                        message_count: Some(c.message_count),
                    })
                    .collect())
            }
        }
    } else {
        live
    }
}

#[tauri::command]
pub async fn chat_create_conversation(
    app: AppHandle,
    agent_id: String,
    body: CreateConversation,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<ChatConversation, String> {
    let endpoint = endpoint_for(&registry, &agent_id).await?;
    let payload = json!({
        "title": body.title,
        "system_prompt": body.system_prompt,
    });
    let conv: ChatConversation = json_request(
        &registry,
        reqwest::Method::POST,
        format!("{endpoint}/conversations"),
        Some(&payload),
    )
    .await?;
    if let Some(db) = db_of(&app) {
        let _ = db.upsert_conversation(
            &agent_id,
            &conv.id,
            conv.title.as_deref(),
            conv.system_prompt.as_deref(),
        );
    }
    Ok(conv)
}

#[tauri::command]
pub async fn chat_get_conversation(
    app: AppHandle,
    agent_id: String,
    id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<ChatConversation, String> {
    let endpoint = endpoint_for(&registry, &agent_id).await?;
    let live: Result<ChatConversation, String> = json_request(
        &registry,
        reqwest::Method::GET,
        format!("{endpoint}/conversations/{id}"),
        None,
    )
    .await;

    let db = db_of(&app);
    match live {
        Ok(mut conv) => {
            // Live succeeded — merge cached messages that the agent may have
            // dropped. We trust the agent's content order (fresh is fresh)
            // and only fill in what's missing by id.
            if let Some(db) = db {
                let _ = db.upsert_conversation(
                    &agent_id,
                    &conv.id,
                    conv.title.as_deref(),
                    conv.system_prompt.as_deref(),
                );
                if let Ok(cached) = db.list_messages(&conv.id) {
                    let mut have: std::collections::HashSet<String> =
                        conv.messages.iter().map(|m| m.id.clone()).collect();
                    for m in cached {
                        if !have.contains(&m.id) {
                            have.insert(m.id.clone());
                            conv.messages.push(ChatMessage {
                                id: m.id,
                                role: m.role,
                                content: m.content,
                                at: Some(m.at),
                            });
                        }
                    }
                    // Stable ordering by `at` so re-merged messages slot in.
                    conv.messages.sort_by(|a, b| a.at.cmp(&b.at));
                    conv.message_count = Some(conv.messages.len());
                }
            }
            Ok(conv)
        }
        Err(_) => {
            // Agent down — serve from cache.
            let db = db.ok_or_else(|| "agent unreachable and chat cache disabled".to_string())?;
            let conv = db
                .get_conversation(&id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("conversation {id} not found in cache"))?;
            let messages = db
                .list_messages(&id)
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|m| ChatMessage {
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    at: Some(m.at),
                })
                .collect::<Vec<_>>();
            let count = messages.len();
            Ok(ChatConversation {
                id: conv.id,
                title: conv.title,
                system_prompt: conv.system_prompt,
                messages,
                updated_at: Some(conv.updated_at),
                message_count: Some(count),
            })
        }
    }
}

#[tauri::command]
pub async fn chat_delete_conversation(
    app: AppHandle,
    agent_id: String,
    id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let endpoint = endpoint_for(&registry, &agent_id).await?;
    let resp = registry
        .http_client()
        .delete(format!("{endpoint}/conversations/{id}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("{}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    if let Some(db) = db_of(&app) {
        let _ = db.delete_conversation(&id);
    }
    Ok(())
}

#[tauri::command]
pub async fn chat_patch_conversation(
    app: AppHandle,
    agent_id: String,
    id: String,
    body: PatchConversation,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<ChatConversation, String> {
    let endpoint = endpoint_for(&registry, &agent_id).await?;
    let payload = json!({
        "title": body.title,
        "system_prompt": body.system_prompt,
    });
    let conv: ChatConversation = json_request(
        &registry,
        reqwest::Method::PATCH,
        format!("{endpoint}/conversations/{id}"),
        Some(&payload),
    )
    .await?;
    if let Some(db) = db_of(&app) {
        let _ = db.upsert_conversation(
            &agent_id,
            &conv.id,
            conv.title.as_deref(),
            conv.system_prompt.as_deref(),
        );
    }
    Ok(conv)
}

// ─── Tauri command: full-text search ──────────────────────────────────────

/// Searches cached message bodies via FTS5. The query is treated as
/// search-as-you-type — the last token is matched with a prefix, all
/// previous tokens are required as exact terms (FTS5 implicit AND).
/// Returns at most `limit` (default 30) most-recent hits across every
/// agent's conversations.
#[tauri::command]
pub async fn chat_search(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let db = match db_of(&app) {
        Some(db) => db,
        None => return Ok(Vec::new()),
    };
    let limit = limit.unwrap_or(30).min(100);
    db.search_messages(&query, limit).map_err(|e| e.to_string())
}

// ─── Tauri command: streaming send ─────────────────────────────────────────

/// Streams a user message to the agent and forwards every SSE frame to the
/// frontend as a `chat-stream` event. Returns once the stream closes (by
/// either side) or fails.
///
/// The frontend supplies a `requestId` so it can correlate frames back to a
/// specific in-flight message; the function emits a synthetic
/// `{ type: "error" }` frame on transport failure so the UI never has to
/// distinguish "stream ended" from "stream broke".
#[tauri::command]
pub async fn chat_send_message(
    app: AppHandle,
    agent_id: String,
    conversation_id: String,
    request_id: String,
    body: SendMessageBody,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<(), String> {
    let endpoint = endpoint_for(&registry, &agent_id).await?;
    let url = format!("{endpoint}/conversations/{conversation_id}/messages");
    let payload = json!({
        "role": "user",
        "content": body.content,
        "model": body.model,
    });

    // Write the user message into the cache up-front so it survives even if
    // the stream blows up halfway through.
    if let Some(db) = db_of(&app) {
        let user_id = format!("local-user-{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        let _ = db.insert_message(&conversation_id, &user_id, "user", &body.content);
    }

    let request_id_for_errors = request_id.clone();
    if let Err(e) = run_stream(&app, &registry, &request_id, &conversation_id, &url, &payload).await
    {
        emit_chat(&app, &request_id_for_errors, "error", &json!({ "message": e.to_string() }));
        return Err(e.to_string());
    }
    Ok(())
}

#[derive(Default)]
struct AssistantBuf {
    id: Option<String>,
    text: String,
}

async fn run_stream(
    app: &AppHandle,
    registry: &Arc<Registry>,
    request_id: &str,
    conversation_id: &str,
    url: &str,
    payload: &Value,
) -> Result<()> {
    let resp = registry
        .http_client()
        .post(url)
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(payload)
        .send()
        .await
        .context("post message")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("{status}: {text}"));
    }

    let mut buffer: Vec<u8> = Vec::with_capacity(4096);
    let mut stream = resp.bytes_stream();
    let mut assistant = AssistantBuf::default();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.context("read sse chunk")?;
        buffer.extend_from_slice(&bytes);

        while let Some(pos) = find_event_boundary(&buffer) {
            let frame = buffer.drain(..pos.end).collect::<Vec<_>>();
            let frame = &frame[..pos.payload_end];
            if let Some(event) = parse_sse_frame(frame) {
                let parsed: Value = serde_json::from_str(&event.data)
                    .unwrap_or_else(|_| json!({ "type": "delta", "data": { "text": event.data } }));
                let kind = parsed
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("delta")
                    .to_string();
                let data = parsed.get("data").cloned().unwrap_or(Value::Null);

                // Track assistant id and accumulate text deltas so we can
                // persist a single assistant message at the end. The agent
                // is free to omit `data.id` — we'll synthesise one then.
                match kind.as_str() {
                    "start" => {
                        if let Some(id) = data.get("id").and_then(|v| v.as_str()) {
                            assistant.id = Some(id.to_string());
                        }
                    }
                    "delta" => {
                        if let Some(t) = data.get("text").and_then(|v| v.as_str()) {
                            assistant.text.push_str(t);
                        }
                    }
                    _ => {}
                }

                emit_chat(app, request_id, &kind, &data);

                if kind == "end" {
                    if let Some(db) = db_of(app) {
                        if !assistant.text.is_empty() {
                            let id = assistant.id.clone().unwrap_or_else(|| {
                                format!(
                                    "local-asst-{}",
                                    chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
                                )
                            });
                            let _ = db.insert_message(
                                conversation_id,
                                &id,
                                "assistant",
                                &json!({ "text": assistant.text }),
                            );
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

struct FramePos {
    end: usize,         // index of first byte after the blank-line separator
    payload_end: usize, // index of last byte of the frame payload
}

/// SSE frames are separated by a blank line. Accept both `\n\n` and `\r\n\r\n`.
fn find_event_boundary(buf: &[u8]) -> Option<FramePos> {
    if let Some(i) = find_subslice(buf, b"\r\n\r\n") {
        return Some(FramePos { end: i + 4, payload_end: i });
    }
    if let Some(i) = find_subslice(buf, b"\n\n") {
        return Some(FramePos { end: i + 2, payload_end: i });
    }
    None
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|w| w == needle)
}

#[derive(Default)]
struct SseEvent {
    data: String,
}

fn parse_sse_frame(bytes: &[u8]) -> Option<SseEvent> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut ev = SseEvent::default();
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            if !ev.data.is_empty() {
                ev.data.push('\n');
            }
            ev.data.push_str(rest.trim_start_matches(' '));
        }
        // event: / id: / retry: are protocol-level; we don't need them here.
    }
    if ev.data.is_empty() {
        None
    } else {
        Some(ev)
    }
}

fn emit_chat(app: &AppHandle, request_id: &str, kind: &str, data: &Value) {
    let _ = app.emit(
        "chat-stream",
        json!({
            "requestId": request_id,
            "type": kind,
            "data": data,
        }),
    );
}
