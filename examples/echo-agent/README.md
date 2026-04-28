# echo-agent

Reference implementation of the Agent Hub protocol v0.1 in **~250 LoC of
Node.js**. Tokenises whatever text you send and streams it back, slowly,
over Server-Sent Events. Useful for:

- developing the hub UI without an LLM provider / API keys / network,
- copy-pasting as a starting point for real agents — the whole protocol fits
  in one file.

## Run

```bash
cd examples/echo-agent
npm install
node server.js                # default port 8741
node server.js --port 9000    # custom port
```

The agent writes its manifest to:

```
~/.config/agent-hub/agents/echo.json          (Linux/macOS)
%APPDATA%\agent-hub\agents\echo.json          (Windows)
```

Stop with `Ctrl+C` or `POST http://127.0.0.1:8741/quit`.

## What it implements

- `GET /status` — `{alive, busy, version, uptime_sec, metrics}`
- `GET /config` / `PUT /config` — config + JSON Schema for the form generator
- `GET /conversations` · `POST /conversations` · `GET|PATCH|DELETE /conversations/{id}`
- `POST /conversations/{id}/messages` — **SSE** stream of `start` → `delta`* → `end`
- `WS /events` — broadcast: `hello`, `agent_busy`, `heartbeat`
- `POST /quit` — graceful shutdown

## Quick smoke test

```bash
# create a conversation
curl -sX POST http://127.0.0.1:8741/conversations \
  -H 'content-type: application/json' \
  -d '{"title":"hi"}'  # → {"id":"…", …}

# stream a reply
curl -N -X POST http://127.0.0.1:8741/conversations/<id>/messages \
  -H 'content-type: application/json' \
  -H 'accept: text/event-stream' \
  -d '{"role":"user","content":[{"type":"text","text":"hello world"}]}'
```

## What it doesn't implement (yet)

- Tools / function calling (`supports_tools: false`)
- Attachments (audio, images, PDF)
- Persistent storage — conversations live in memory and die with the process

These are intentionally omitted to keep the file readable. The contract has
hooks for all of them — see [`PROTOCOL.md`](../../PROTOCOL.md).
