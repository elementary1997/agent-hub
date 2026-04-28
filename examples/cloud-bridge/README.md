# cloud-bridge — reference AI agent

Tiny streaming bridge between Agent Hub and frontier LLMs, following
the Hub protocol v0.1. Default provider is **OpenRouter** — one API
key gets you Claude, GPT, Gemini, Llama, DeepSeek, and most other
chat-completion models with the same OpenAI-compatible schema.

```
hub  ──HTTP/SSE──▶  cloud-bridge  ──HTTPS/SSE──▶  OpenRouter ──▶  vendor
```

The agent itself stays tiny on purpose — about 400 LoC of plumbing —
and is structured so you can swap or add providers without touching
`server.js`. Each provider lives in `src/providers/<name>.js` and
exposes a single async generator yielding `{ type: "delta" | "end",
data: ... }` events.

## Quickstart

```bash
cd examples/cloud-bridge
npm install
OPENROUTER_API_KEY=sk-or-... npm start
```

The agent registers itself at `~/.config/agent-hub/agents/cloud-bridge.json`
(`%APPDATA%\agent-hub\agents\cloud-bridge.json` on Windows), so the
hub picks it up the moment you launch it. The card will show under
"AI" with a blue accent, and the command palette can chat with it
directly via ⌘K → "Chat with Cloud Bridge".

## Configuration

| Env                            | Effect                                               | Default                       |
| ------------------------------ | ---------------------------------------------------- | ----------------------------- |
| `OPENROUTER_API_KEY`           | Required for OpenRouter                              | —                             |
| `CLOUDRU_BEARER`               | Required for Cloud.ru (when implemented)             | —                             |
| `CLOUD_BRIDGE_PROVIDER`        | `openrouter` (default) \| `cloudru`                  | `openrouter`                  |
| `CLOUD_BRIDGE_DEFAULT_MODEL`   | Model id used when a request omits `model`          | `anthropic/claude-sonnet-4.5` |
| `CLOUD_BRIDGE_PORT` / `--port` | TCP port to listen on                                | `8742`                        |

Runtime knobs (`provider`, `default_model`, `max_tokens`,
`temperature`) are also exposed via the protocol's `GET / PUT /config`
endpoints, so the hub's Settings tab can edit them live.

## Endpoints

Implements the full Agent Hub protocol v0.1:

- `GET /status`, `POST /quit`, `POST /open-native-ui` (returns 404 — no
  native UI by design)
- `GET /config`, `PUT /config` with a JSON-Schema-driven form
- `GET /conversations`, `POST /conversations`,
  `GET|PATCH|DELETE /conversations/:id`
- `POST /conversations/:id/messages` — `text/event-stream`, frames
  shaped `{ type: "start" | "delta" | "end" | "error", data: ... }`
- `GET /events` — WebSocket for `agent_busy` and `heartbeat` broadcasts

## Adding a provider

1. Create `src/providers/<name>.js` exporting an async generator with
   the same shape as `streamOpenRouter`.
2. Wire it up in `streamFor` / `keyFor` / `keyEnvName` inside
   `src/server.js`.
3. Add the provider to the `provider` enum in `getConfig`'s schema.
4. (Optional) seed `DEFAULT_MODELS` with provider-prefixed ids.

That's it — the hub will pick it up via `PUT /config`'s schema and
let users switch providers at runtime.

## Limits

- In-memory conversation store. The hub's SQLite cache (`chatdb.rs`)
  persists chat history on its side, so this is fine for a reference;
  a real adapter for production should still keep its own durable
  store so the hub can re-sync on hub-side data loss.
- No tool / function calling yet (`supports_tools: false` in the
  manifest).
- No attachments yet (`supports_attachments: false`). Adding them is a
  matter of forwarding non-text content parts in `buildMessages`.
