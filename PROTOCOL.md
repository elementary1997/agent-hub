# Agent Hub Protocol v0.1

This document is the **contract** every agent implements to participate in the
hub. It is intentionally minimal — the goal is that wrapping an existing
process (LLM API client, voice utility, scraper…) is a single afternoon of work.

The protocol is **HTTP + WebSocket on `127.0.0.1`**. JSON for everything.

## 1. Manifest

Each agent writes (or ships) a JSON manifest at:

```
~/.config/agent-hub/agents/<id>.json          (Linux/macOS)
%APPDATA%\agent-hub\agents\<id>.json          (Windows)
```

The hub watches this directory and reloads whenever a manifest is added,
modified, or removed.

### Required fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable, kebab-case. Used everywhere as primary key. |
| `name` | string | Human-readable, shown on cards. |
| `version` | semver | Manifest format follows the agent's version. |
| `kind` | enum | `"ai"`, `"utility"`, `"service"`. Drives which extra fields apply. |
| `endpoint` | URL | `http://127.0.0.1:<port>` — base for HTTP and WS. |
| `lifecycle` | enum | `"managed"` (hub spawns) or `"standalone"` (user runs it). |

### Optional fields

| Field | Type | Notes |
|-------|------|-------|
| `executable` | path | Required if `lifecycle == "managed"`. |
| `args` | array | CLI args for spawn. |
| `env` | object | Extra env vars (merged into hub env). |
| `icon` | data-URI / path | PNG, ≥64×64. |
| `tagline` | string | One line for cards. |
| `tags` | array | Free-form, used in filters. |
| `accent` | color | `#RRGGBB`. Drives card / chat accent. |
| `auto_start_on_hub_launch` | bool | Default `false`. |

### `kind: "ai"` extension

```json
{
  "ai": {
    "supports_streaming": true,
    "supports_tools": false,
    "supports_attachments": ["image", "audio", "pdf"],
    "models": ["gpt-4o", "claude-sonnet-4"],
    "default_model": "claude-sonnet-4",
    "system_prompt_editable": true,
    "max_input_tokens": 200000
  }
}
```

### Example

```json
{
  "id": "easystt",
  "name": "easySTT",
  "version": "0.2.0",
  "kind": "utility",
  "endpoint": "http://127.0.0.1:8731",
  "lifecycle": "standalone",
  "icon": "data:image/png;base64,iVBORw0KGgoAAAA…",
  "tagline": "Voice-to-text injection",
  "tags": ["productivity", "input"],
  "accent": "#4c84ff"
}
```

## 2. HTTP API (all agents)

All endpoints return `application/json` unless stated otherwise. All errors
follow:

```json
{ "error": { "code": "string", "message": "human readable" } }
```

### `GET /status`

Probed by the hub every ~3s. Should respond in <100 ms.

```json
{
  "alive": true,
  "busy": false,
  "version": "0.2.0",
  "uptime_sec": 3421,
  "last_event": "2026-04-28T18:11:00Z",
  "metrics": { "requests_total": 17 }
}
```

### `GET /config` / `PUT /config`

`GET` returns the current config plus a [JSON Schema][jsonschema] describing
its shape. The hub renders a settings form from the schema:

```json
{
  "config": { "language": "ru", "model": "tiny" },
  "schema": {
    "type": "object",
    "properties": {
      "language": { "type": "string", "enum": ["ru", "en", "auto"] },
      "model": { "type": "string", "enum": ["tiny", "base", "small"] }
    }
  }
}
```

`PUT` applies a new config (validated against the schema first). Agent should
hot-reload where possible.

### `POST /open-native-ui` *(optional)*

Asks the agent to surface its own GUI window (e.g. easySTT settings). Useful
for "open native" buttons in the hub.

### `POST /quit`

Graceful shutdown. Used by the hub to stop managed agents cleanly. After 5 s
without exit, hub falls back to SIGTERM/SIGKILL.

## 3. WebSocket events

`WS <endpoint>/events` — long-lived. Every event is JSON, one per frame:

```json
{ "type": "agent_busy",  "data": { "busy": true,  "reason": "transcribing" } }
{ "type": "agent_busy",  "data": { "busy": false } }
{ "type": "log",         "data": { "level": "info", "message": "..." } }
{ "type": "error",       "data": { "code": "...", "message": "..." } }
{ "type": "usage_update","data": { "tokens_in": 12, "tokens_out": 36 } }   // ai only
{ "type": "tool_called", "data": { "tool": "web_search", "args": { … } } } // ai only
```

The hub aggregates these into a per-agent activity feed (detail view) and uses
`agent_busy` to tint the card.

## 4. AI-specific endpoints (`kind: "ai"`)

### Conversations

| Method | Path | Body / Notes |
|--------|------|-------------|
| `GET`    | `/conversations`              | List `[{id, title, updated_at, message_count}]` |
| `POST`   | `/conversations`              | `{title?: string, system_prompt?: string}` → new conversation |
| `GET`    | `/conversations/{id}`         | Full metadata + messages |
| `DELETE` | `/conversations/{id}`         | Remove |
| `PATCH`  | `/conversations/{id}`         | `{title?, system_prompt?}` |

### Sending messages — streaming

```
POST /conversations/{id}/messages
Content-Type: application/json
Accept: text/event-stream

{
  "role": "user",
  "content": [
    { "type": "text", "text": "Summarise the file" },
    { "type": "image", "data": "data:image/png;base64,..." }
  ],
  "model": "claude-sonnet-4"   // optional, falls back to default_model
}
```

Response is **Server-Sent Events**:

```
data: {"type":"start","data":{"message_id":"msg_abc"}}

data: {"type":"delta","data":{"text":"Sure"}}

data: {"type":"delta","data":{"text":", here is …"}}

data: {"type":"tool_call","data":{"name":"read_file","args":{...}}}

data: {"type":"tool_result","data":{"name":"read_file","result":"..."}}

data: {"type":"end","data":{"finish_reason":"stop","usage":{"in":18,"out":94}}}
```

The hub renders deltas as they arrive. If the agent doesn't support streaming
(`supports_streaming: false`), the same response is delivered as a single
`text/event-stream` frame `start → delta(full text) → end`.

## 5. Discovery & lifecycle

1. On launch, hub scans the manifest dir.
2. For each `lifecycle: "managed"` agent: hub may spawn the executable
   (depending on `auto_start_on_hub_launch` and user toggles in the UI).
3. For each `lifecycle: "standalone"` agent: hub probes `/status` and shows
   it as offline if unreachable, with a "running but not responsive" hint
   if the executable is alive but the port is closed.
4. Hub keeps one persistent WS to `/events` per alive agent.
5. On manifest change, the hub diffs and re-applies (start/stop/reconnect as
   needed) without restarting itself.

## 6. Versioning

This document is **v0.1** of the protocol. Backwards-incompatible changes
bump the major number; the hub will refuse manifests with an unknown major
version. Agents may declare the protocol version they implement via
`"protocol": "0.1"` in the manifest (default `"0.1"` if absent).

## 7. Reference implementations

- `examples/echo-agent/` — minimal `kind: "ai"` agent in ~150 LoC of Node.
- `easySTT` — `kind: "utility"`, real-world standalone agent.

[jsonschema]: https://json-schema.org/
