# Agent Hub

Centralised control panel for personal mini-agents. Launch the hub at login and get
a unified view over every agent you run — chat with AI, watch their status, open
their native UIs, manage their lifecycle.

> **Status:** spec & scaffolding. No working binary yet — see [`ROADMAP.md`](./ROADMAP.md).

## What it is

Local-first desktop app (Tauri 2 + React) that:

- Discovers agents from manifests in `~/.config/agent-hub/agents/*.json`
- Talks to each agent over a small **HTTP + WebSocket contract** on `127.0.0.1`
- Displays them as cards with live status, supports **start / stop / configure / chat**
- Lets each agent keep its own native UI — the hub never replaces, only augments

## Why

The author runs several specialised utilities — `easySTT` for voice input, future
AI agents (research assistant, automation bots), system tools. Each is great on
its own, but switching between trays / shortcuts / tabs is painful. Agent Hub is
the single place where you see them all and command them at once.

## Architecture in one paragraph

Agents are **independent processes**, each on its own stack (Rust, Python, Node,
whatever). They speak a uniform [contract](./PROTOCOL.md) over local HTTP/WS.
The hub is a **process supervisor + dashboard + chat UI**. It can either spawn
managed agents itself (`lifecycle: managed`) or just talk to ones the user
runs separately (`lifecycle: standalone`). The protocol is AI-first in v0.x —
chat / streaming responses / conversation history — but generalises to any
agent kind via the `kind` field in the manifest.

## Repository layout (planned)

```
agent-hub/
├── README.md
├── PROTOCOL.md            ← the contract every agent implements
├── ROADMAP.md             ← v0.1 → v1.0 milestones
├── src/                   ← React frontend (cards, chat, palette, settings)
├── src-tauri/             ← Rust core: registry, process manager, event bus
└── examples/
    └── echo-agent/        ← reference agent in ~150 LoC
```

## First reference agent

[`easySTT`](https://github.com/elementary1997/easySTT) — voice-to-text utility
that already runs as a standalone Tauri app. We add a thin HTTP/WS server to
it (~150 LoC, a separate PR in the easySTT repo) so it satisfies the contract
without rewriting anything.

## Tech stack

| Layer | Choice |
|-------|--------|
| Shell | Tauri 2 |
| UI | React 18 + TypeScript + Vite |
| Styles | Tailwind 3 + shadcn/ui |
| Animations | framer-motion |
| State | Zustand |
| DB (conversations) | SQLite via `tauri-plugin-sql` |
| HTTP / WS in Rust | reqwest + tokio-tungstenite |

## License

MIT (planned).
