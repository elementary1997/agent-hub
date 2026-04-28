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
use tauri::{AppHandle, Emitter};

use crate::agents::Registry;

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

#[tauri::command]
pub async fn chat_list_conversations(
    agent_id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<Vec<ChatConversation>, String> {
    let endpoint = endpoint_for(&registry, &agent_id).await?;
    json_request(&registry, reqwest::Method::GET, format!("{endpoint}/conversations"), None).await
}

#[tauri::command]
pub async fn chat_create_conversation(
    agent_id: String,
    body: CreateConversation,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<ChatConversation, String> {
    let endpoint = endpoint_for(&registry, &agent_id).await?;
    let payload = json!({
        "title": body.title,
        "system_prompt": body.system_prompt,
    });
    json_request(
        &registry,
        reqwest::Method::POST,
        format!("{endpoint}/conversations"),
        Some(&payload),
    )
    .await
}

#[tauri::command]
pub async fn chat_get_conversation(
    agent_id: String,
    id: String,
    registry: tauri::State<'_, Arc<Registry>>,
) -> Result<ChatConversation, String> {
    let endpoint = endpoint_for(&registry, &agent_id).await?;
    json_request(
        &registry,
        reqwest::Method::GET,
        format!("{endpoint}/conversations/{id}"),
        None,
    )
    .await
}

#[tauri::command]
pub async fn chat_delete_conversation(
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
    Ok(())
}

#[tauri::command]
pub async fn chat_patch_conversation(
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
    json_request(
        &registry,
        reqwest::Method::PATCH,
        format!("{endpoint}/conversations/{id}"),
        Some(&payload),
    )
    .await
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

    let request_id_for_errors = request_id.clone();
    if let Err(e) = run_stream(&app, &registry, &request_id, &url, &payload).await {
        emit_chat(&app, &request_id_for_errors, "error", &json!({ "message": e.to_string() }));
        return Err(e.to_string());
    }
    Ok(())
}

async fn run_stream(
    app: &AppHandle,
    registry: &Arc<Registry>,
    request_id: &str,
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
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.context("read sse chunk")?;
        buffer.extend_from_slice(&bytes);

        while let Some(pos) = find_event_boundary(&buffer) {
            let frame = buffer.drain(..pos.end).collect::<Vec<_>>();
            let frame = &frame[..pos.payload_end];
            if let Some(event) = parse_sse_frame(frame) {
                forward_event(app, request_id, &event);
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

fn forward_event(app: &AppHandle, request_id: &str, ev: &SseEvent) {
    let payload: Value = match serde_json::from_str(&ev.data) {
        Ok(v) => v,
        Err(_) => json!({ "type": "delta", "data": { "text": ev.data } }),
    };
    let kind = payload
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("delta")
        .to_string();
    let data = payload.get("data").cloned().unwrap_or(Value::Null);
    emit_chat(app, request_id, &kind, &data);
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
