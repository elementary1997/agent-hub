# Roadmap

Each milestone is a working deliverable — usable end of every step, not just
end of v1.0.

## v0.1 — Foundation

Goal: see a real running agent in the hub, open its native UI from the hub.

- [x] Tauri 2 + React + Tailwind + shadcn primitives scaffolding (`e01e584`)
- [x] Dark theme, base layout (sidebar + card grid) (`e01e584`)
- [x] Manifest registry — read `~/.config/agent-hub/agents/*.json`,
      hot-reload via `notify` (`771ddc4`)
- [x] HTTP client per agent: `GET /status` polled every 3 s (`771ddc4`)
- [x] WebSocket subscription to `/events`, runtime busy/error dispatch +
      `agent-event` Tauri stream + 50-event rolling buffer per agent
- [x] Card with: name, status dot, busy indicator, last event time, accent
- [x] Buttons: "Open native UI" (POSTs `/open-native-ui`), "Settings" (placeholder)
- [x] **easySTT integration** — `agent_api.rs` axum server + manifest writer
- [x] **CI** — Build + Release workflows for `.exe` + `.deb`

End state achieved (commits b1d0000 → 771ddc4 → v0.1.2): hub picks up easySTT
and the echo-agent automatically, busy state flips instantly via WS, "Open"
button raises easySTT's settings window. Round trip works.

## v0.2 — AI agent v1

Goal: a real chat with an AI agent inside the hub.

### v0.2.0 — Chat MVP (shipped)

- [x] Rust SSE client over reqwest with framing for `data:` events
- [x] Tauri commands: list / create / get / delete / patch conversations
- [x] `chat_send_message` streams `chat-stream` events (`requestId` per call,
      type-routed: `start` / `delta` / `tool_call` / `tool_result` / `end` / `error`)
- [x] `<ChatView/>`: conversations rail + composer + streaming bubble
- [x] Markdown rendering with `react-markdown` + GFM + `rehype-highlight`
- [x] System prompt editor (collapsible) when manifest declares
      `system_prompt_editable: true`
- [x] Model picker (driven by `ai.models`)
- [x] Conversation list / rename (via system prompt save) / delete

### v0.2.1 — Persistence + reference adapter (next)

- [ ] SQLite via `tauri-plugin-sql` for local cache of `conversations` /
      `messages` so chat survives agent restarts
- [ ] Conversation search (FTS5)
- [ ] Image / audio attachments where `supports_attachments` allows
- [ ] **Reference AI agent** — thin adapter over Cloud.ru / OpenRouter
      (re-uses keys already configured in easySTT). Implements
      `kind: "ai"` contract end-to-end. ~400 LoC, separate repo.

End state (after v0.2.1): open hub → click AI agent → start a chat →
tokens stream in, history survives restarts.

## v0.3 — Process Manager + Settings

Goal: hybrid lifecycle works; agents can be configured from the hub.

### v0.3.0 — Supervisor (shipped)

- [x] Spawn `lifecycle: "managed"` agents via `tokio::process::Command`
- [x] Crash recovery with budget (max 3 attempts in 60 s, then give up)
- [x] Stdout/stderr piped into a per-agent ring buffer (1000 lines) +
      live `agent-log` Tauri stream for tailing
- [x] Tauri commands: `agent_start`, `agent_stop_managed`, `agent_logs`,
      `agent_is_managed_running`
- [x] Card buttons wired: Stop sends supervisor.stop() (POST /quit then
      kill on grace timeout); Start spawns the manifest's executable

### v0.3.1 — Settings + auto-start (next)

- [ ] JSON-Schema-driven settings form generator
      (`@rjsf/core` or hand-rolled with shadcn primitives) backed by
      `GET /config` / `PUT /config`
- [ ] Per-agent toggle "auto-start with hub" — honours
      `auto_start_on_hub_launch` from the manifest
- [ ] Log viewer panel inside the agent detail page (consumes the
      existing `agent-log` Tauri stream)

End state (after v0.3.1): all four lifecycle/configure paths work end-to-end.

## v0.4 — UX polish (target: 1 week)

Goal: feels modern.

- [ ] Command palette (`⌘K` / `Ctrl+K`) with fuzzy search across:
      agents, conversations, actions ("start easystt", "open settings of …")
- [ ] Per-agent accent colours propagate to card / chat / palette result rows
- [ ] framer-motion for card hover, mount, list reorder, message bubble appear
- [ ] Sidebar filters: All / Running / By kind / By tag
- [ ] Theme switcher (dark / light), persistent in store
- [ ] Global hotkeys: "open hub", "new chat with last-used AI"

End state: feels fast and pretty without breaking.

## v1.0 — Polish & release (target: 1 week)

Goal: shippable, signed, auto-updating.

- [ ] Onboarding flow: first launch detects no agents → walks user through
      installing easySTT + reference AI agent
- [ ] Auto-update via Tauri updater
- [ ] Tray icon with quick actions (status, new chat, quit)
- [ ] Conversation export / backup (markdown + JSON)
- [ ] Signed builds for Windows + Linux (.msi, .deb, .AppImage)
- [ ] Docs site (basic)

End state: install, run, forget about plumbing.

## Future (post-1.0, no commitments)

- Voice command bar (route easySTT transcripts to AI agents by intent)
- Linux Wayland-native paths where it matters
- macOS support (build matrix already structured for it)
- Sandbox for managed agents (cgroups / firejail / Windows Job Objects)
- Plugin SDK for non-process agents (WASM modules)
- Cross-device sync of conversations via user-owned backend
- Multi-user / shared agents

## Out of scope

- Cloud-hosted version — this is local-first by design
- Mobile app
- App store distribution (use direct downloads + auto-update)
