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

### v0.2.1 — Persistence + reference adapter

- [x] **v0.2.1a** SQLite-backed chat cache (`chatdb.rs`, rusqlite + bundled
      SQLite). Write-through on every CRUD success; user message persisted
      up-front; SSE `delta` frames accumulated and the final assistant
      message committed on `end`. List / get fall back to the cache when
      the agent is unreachable, so history survives agent crashes,
      reinstalls, and offline opens.
- [x] **v0.2.1b** Conversation search (FTS5). Virtual `messages_fts`
      table, `unicode61` tokenizer with diacritic folding, recursive
      JSON-text projection (biased toward `text`/`content`/`delta`), and
      first-run backfill of pre-existing rows. Exposed as `chat_search`
      Tauri command with safe prefix-search query building (last token
      gets `*`, every token quoted to neutralise FTS5 syntax). Wired into
      the command palette: typing ≥ 2 characters debounces a search and
      adds matching message snippets alongside agent actions, deep-linking
      into the right conversation on Enter.
- [ ] **v0.2.1c** Image / audio attachments where `supports_attachments`
      allows — content blob stored on disk under the app data dir,
      referenced by id from `messages.content`.
- [x] **v0.2.1d** Reference AI agent (`examples/cloud-bridge`) —
      Node.js implementation of the full Hub protocol that streams
      OpenRouter chat completions over SSE. One file of HTTP/WS
      plumbing plus a swappable provider per file under
      `src/providers/`. Cloud.ru lane stubbed with the same generator
      contract so adopters can wire their auth flow without touching
      `server.js`. Manifest auto-publishes to the standard discovery
      path; provider, default model, max tokens and temperature are
      live-editable through the hub's Settings tab via JSON-Schema.

End state (after full v0.2.1): open hub → click AI agent → start a chat →
tokens stream in, history survives restarts even if the agent is gone.

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

### v0.3.1 — Detail page (shipped)

- [x] `<AgentDetail/>` page reachable from each card's Settings button
      (Activity / Logs / Config tabs, header with status, version, endpoint,
      contextual actions: Chat for AI · Open native · Start · Stop)
- [x] JSON-Schema-driven settings form generator (`<SchemaForm/>`) backed by
      `agent_get_config` / `agent_put_config` Tauri commands. Handles
      string / number / boolean / enum out of the box, falls back to a raw
      JSON editor when the schema is missing or too exotic.
- [x] Live log viewer with stream-coloured lines (stdout / stderr /
      supervisor) consuming the existing `agent-log` Tauri stream.
- [x] Activity feed reads the per-agent rolling event buffer populated by
      the v0.1.2 WebSocket client.

### v0.3.2 — Auto-start + tray (shipped)

- [x] Per-agent toggle "Auto-start with hub" — honours
      `auto_start_on_hub_launch` from the manifest, with a user override
      persisted via `tauri-plugin-store`. Effective value computed as
      `user_override ?? manifest_default ?? false`.
- [x] `prefs::maybe_autostart` runs on every manifest upsert — initial
      scan and live edits both honour the toggle without a hub restart.
- [x] System tray icon with Show / Quit menu; left-click brings the main
      window back from the dock.

End state: all four lifecycle/configure paths work end-to-end.

## v0.4 — UX polish

Goal: feels modern.

### v0.4.0 — Palette, tags, version visibility (shipped)

- [x] Command palette (`⌘K` / `Ctrl+K`) with prefix/word/substring/subsequence
      scoring. Actions: chat with AI agents, open details, open native UI,
      start / stop managed agents. Per-agent accent on result rows.
- [x] Per-agent accent colours propagate to cards, chat header, palette,
      detail page header.
- [x] framer-motion for card hover, mount, list reorder, message bubble appear,
      palette in/out, activity feed entries.
- [x] Sidebar filters: All / Running / By kind / By tag (auto-populated from
      manifest tags, sorted by count).
- [x] Build version + short git SHA visible in the Topbar and Sidebar so
      it's obvious which build is running. Wired via Vite `define` so the
      string is baked into the bundle at build time.
- [x] Versioning unified: package.json, Cargo.toml, tauri.conf.json all on
      0.4.0. The `.deb` / `.exe` filenames now bump on every release.

### v0.4.1 — Global hotkeys (shipped)

- [x] Global hotkey "Show hub" — `Ctrl+Shift+H` brings the main window from
      anywhere via `tauri-plugin-global-shortcut`. Best-effort registration:
      logs and continues if the combo is owned by another app, so the rest
      of the hub still boots.
- [x] Sidebar footer renders the hotkey hint so users discover it without
      hunting through settings.

### v0.4.2 — Theme switcher + custom hotkeys (next)

- [ ] Theme switcher (dark / light), persistent in `tauri-plugin-store`.
      Requires re-tokenising the existing palette through CSS variables so
      Tailwind can swap both colour systems off a single `data-theme` flag.
- [ ] User-configurable hotkey for "Show hub" + a second binding for
      "New chat with last-used AI".

End state: feels fast and pretty without breaking.

### v0.4.x — Hub Settings page (shipped)

- [x] Real Settings screen (sidebar bottom button + ⌘K → "Open Settings").
      Sections: Build (version / git hash / built-at), Hotkeys reference,
      Storage (manifest dir, chat.db path + size + counts via new
      `chat_db_stats` Tauri command, refresh button), Auto-start matrix
      with per-agent toggles, Chat history explainer, About + repo link.

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
