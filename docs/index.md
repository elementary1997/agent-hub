# Agent Hub Docs

Local-first desktop hub for personal agents.

## Quick Start

1. Install dependencies:
   - `npm ci`
2. Run in development:
   - `npm run tauri:dev`
3. Build release artifacts:
   - `npm run tauri:build`

## Core Concepts

- **Manifest registry**: agents are discovered from local manifest files.
- **Managed lifecycle**: the hub can start/stop supervised agents.
- **Chat cache**: AI chat history is mirrored to local SQLite.
- **Marketplace**: install easySTT/OpenRouter/Cloud.ru integrations.

## User Guides

- `docs/operations.md` — run/install/backup/update operations.
- `docs/protocol.md` — links to protocol contract.
- `docs/signing-and-updates.md` — updater keys, signing, release secrets.

## References

- Protocol: `PROTOCOL.md`
- Roadmap: `ROADMAP.md`
- Source repository: <https://github.com/elementary1997/agent-hub>
