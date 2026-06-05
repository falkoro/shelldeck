# ShellDeck Desktop — design spec (2026-06-04)

A native, auto-updating desktop app that wraps the existing ShellDeck web UI in a real
OS window, pointed at a ShellDeck **server** (where `tmux`/`ssh` run). The browser stays
fully supported against the same server — the desktop app is an additive client, not a
fork of the server.

## Why a thin client (not a bundled server)

ShellDeck's core shells out to `tmux` and `ssh`, which are Linux-native. A self-contained
Windows `.exe` cannot run tmux locally. So the cross-platform desktop product is a **thin
client**: a small Tauri shell that loads a user-configured server URL in a webview and adds
native niceties (tray, single-instance, persistent login, auto-update). No server code is
bundled in v1.

## Stack decisions (locked)

- **Framework:** Tauri **v2** (reuses Rust toolchain, ~5–10 MB installer, built-in signed updater).
- **Model:** thin client → remote ShellDeck server.
- **Update + download host:** Cloudflare **R2** (artifacts + `latest.json`) + **Pages** (landing).
- **v1 targets:** Windows `.exe` (NSIS) + Linux **AppImage** and **.deb**. No macOS in v1.
- **Code signing:** **skipped in v1** (Windows SmartScreen warning accepted); Authenticode is a fast-follow.
- **Repo layout:** Tauri app in `desktop/`, landing site in `site/`, CI in `.github/workflows/`.
- **Brand:** standalone product. Placeholder domain `shelldeck.app` / downloads at `dl.shelldeck.app`
  — keep the domain in ONE config constant so it's a one-line change later.

## Components

### 1. `desktop/` — Tauri v2 app
- **Rust shell (`src-tauri/`):**
  - Native window; remembers size/position (window-state plugin).
  - **System tray:** Show/Hide, Open in browser, Check for updates, Switch server, Quit.
  - **Single-instance** (focus existing window on relaunch).
  - **Updater plugin** (`tauri-plugin-updater`): check on launch + hourly against
    `https://dl.shelldeck.app/desktop/{{target}}/{{arch}}/latest.json`; download the signed
    artifact, install, relaunch. Public key embedded via `tauri.conf.json`; private key only in CI.
- **Frontend (`desktop/src/`):** minimal — NOT a copy of the dashboard. Two local screens:
  - **First-run / settings:** input + save the ShellDeck server URL (persisted via the store
    plugin or localStorage). Validate reachability before saving.
  - **Connection-error screen:** shown when the saved URL is blank/unreachable — friendly
    message + "Edit server URL" + "Retry". Never a blank white webview.
  - Once a valid URL is saved, the webview **navigates to that URL** and the existing ShellDeck
    login page handles auth; cookies persist across launches (stay signed in).
- **`tauri.conf.json`:** productName "ShellDeck", identifier `app.shelldeck.desktop`, bundle
  targets `nsis` (Windows) + `appimage`,`deb` (Linux), icons, updater endpoints + pubkey,
  CSP that allows connecting to arbitrary user servers (the server URL is user-supplied).

### 2. `.github/workflows/desktop-release.yml`
- Trigger: push tag matching `desktop-v*`.
- Jobs:
  - **linux** (`ubuntu-latest`): install Tauri deps (webkit2gtk, etc.), build → AppImage + .deb.
  - **windows** (`windows-latest`, GitHub-hosted — the self-hosted pool is Linux-only): build → NSIS `.exe`.
- Sign artifacts with the Tauri updater key (`TAURI_SIGNING_PRIVATE_KEY` + `..._PASSWORD` secrets).
- Generate per-target `latest.json`, upload installers + manifests to R2 at
  `dl.shelldeck.app/desktop/...` (wrangler or rclone, creds from secrets), and attach to a GitHub Release.

### 3. `site/` — Cloudflare Pages landing
- Static (plain HTML/CSS or Astro — match what's simplest; no heavy framework needed).
- Hero, 2–3 real screenshots, "Download for Windows / Linux" buttons (pull current version from
  `latest.json`), a short "auto-updates itself" explainer, and "or just use it in your browser."
- **Copy must NOT read as AI-generated** (no "Elevate your workflow", no emoji-bullet slop,
  no three-adjective hero). Plain, concrete, engineer-to-engineer.

## Data flow
1. Launch → read saved server URL → if valid, webview loads it (existing login handles auth) → live dashboard.
2. No/invalid/unreachable URL → local error/settings screen.
3. Background: updater checks `latest.json` on launch + hourly → if newer + signature valid →
   download → install → relaunch. Failures retry silently next interval; never block use.

## Security (hard rules — match repo guardrails)
- The Tauri signing **private key** and **R2 credentials** live ONLY in GitHub Actions secrets
  (or `0600` local files). NEVER commit them, never write them into the repo, never echo them.
- Commit only the updater **public key** (in `tauri.conf.json`).
- Tauri enforces signature match on updates — no unsigned/forged update can install.

## Verification
- Build a Linux **AppImage** locally, launch it, point at `https://code.falkinator.org`, confirm:
  live dashboard renders, tray works, login persists across relaunch.
- Windows `.exe` builds in CI; smoke-test on a Windows VM later (note the SmartScreen-unsigned caveat).
- A staged update: bump version, publish a newer signed artifact, confirm the app self-updates.

## Out of scope for v1 (YAGNI)
- Bundled self-contained server mode (Linux/Mac one-binary) — possible later via a Tauri sidecar.
- macOS build + notarization.
- Code signing / Authenticode.
- Auto-discovery of servers, multi-server tabs, deep links.
