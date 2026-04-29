# Signed Releases and Auto-Update

This project uses Tauri updater signatures for secure update delivery.

## 1) Generate updater keypair

Run locally once:

- `npm run tauri signer generate -w ~/.config/agent-hub/updater.key`

It produces:

- private key (keep secret)
- public key (put into `src-tauri/tauri.conf.json` -> `plugins.updater.pubkey`)

## 2) Configure app pubkey

Update:

- `src-tauri/tauri.conf.json`

Set `plugins.updater.pubkey` to the generated public key content.

## 3) Configure GitHub secrets

In repository secrets add:

- `TAURI_SIGNING_PRIVATE_KEY` — full private key content
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — passphrase used during key generation

Release workflow fails fast if either secret is missing.

## 4) Publish release

Tag and push:

- `git tag vX.Y.Z`
- `git push origin vX.Y.Z`

The release workflow builds and uploads signed bundles:

- Windows: `.exe` and `.msi`
- Linux: `.deb` and `.AppImage`

Updater metadata (`latest.json` + signatures) is generated and attached to the release artifacts by Tauri action.
