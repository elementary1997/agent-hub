# Roadmap

Each milestone is a working deliverable — usable end of every step, not just
end of v1.0.

## v0.1 — Foundation (target: 1–2 weeks)

Goal: see a real running agent in the hub, open its native UI from the hub.

- [ ] Tauri 2 + React + Tailwind + shadcn/ui scaffolding
- [ ] Dark theme, base layout (sidebar + card grid)
- [ ] Manifest registry — read `~/.config/agent-hub/agents/*.json`,
      hot-reload on changes
- [ ] HTTP client per agent: `GET /status` polled every 3 s
- [ ] WebSocket subscription to `/events`, aggregated activity feed
- [ ] Card with: name, status dot, busy indicator, last event time, accent colour
- [ ] Buttons: "Open native UI" (POSTs `/open-native-ui`), "Settings"
- [ ] **easySTT integration** — separate PR in easySTT repo:
      `agent_api.rs` (~150 LoC: axum server, manifest write at startup)

End state: launch hub → see easySTT card with live status → click "Open native"
→ easySTT settings window pops up. Round trip works.

## v0.2 — AI agent v1 (target: 2 weeks)

Goal: a real chat with an AI agent inside the hub.

- [ ] SQLite via `tauri-plugin-sql` for `conversations`, `messages`
- [ ] Chat view inside the agent detail page:
  - [ ] Message list with markdown + code blocks
  - [ ] SSE streaming, smooth deltas (no flicker)
  - [ ] Model picker (driven by `ai.models` from manifest)
  - [ ] System prompt editor (collapsible)
  - [ ] Image / file attachments (where `supports_attachments` allows)
- [ ] **Reference AI agent** — thin adapter over Cloud.ru / OpenRouter
      (re-uses keys already configured in easySTT). Implements
      `kind: "ai"` contract end-to-end. ~400 LoC, separate repo.
- [ ] Conversation list, rename, delete, search

End state: open hub → click AI agent → start a chat → tokens stream in.

## v0.3 — Process Manager + Settings (target: 1 week)

Goal: hybrid lifecycle works; agents can be configured from the hub.

- [ ] Spawn `lifecycle: "managed"` agents as Tauri sidecar / `tokio::process`
- [ ] Crash recovery with exponential backoff (max 3 attempts in 60 s)
- [ ] Stdout/stderr piped into per-agent log buffer (visible in detail view)
- [ ] JSON-Schema-driven settings form generator
      (using e.g. `@rjsf/core` or hand-rolled with shadcn primitives)
- [ ] Per-agent toggle "auto-start with hub"

End state: all four lifecycle/configure paths work end-to-end.

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
