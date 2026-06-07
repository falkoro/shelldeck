# ShellDeck
<img width="2200" height="1392" alt="image" src="https://github.com/user-attachments/assets/e7da59c9-ecfa-42a9-9258-11f594b12ff5" />

A small, self-hosted web dashboard to **monitor and drive your `tmux` sessions and AI coding agents** (Claude Code, Codex, opencode, Grok, …) from a browser — including a **real interactive terminal**. Single Rust binary, no database.

It was built to babysit a fleet of long-running agent sessions from a phone or a locked-down client network, but it works for any tmux setup.

## Features

- **Side-by-side shell previews** — live `tmux capture-pane` of each session, streamed over SSE (~1s), with TUI blank-line noise collapsed.
- **Running / waiting badges** — detected from the live pane: a session whose output keeps changing is "running", one that's gone quiet is "waiting for input". Works for any agent or program, with no dependence on a specific status phrase.
- **Last activity** — tmux `session_activity` timestamps are shown as friendly relative times ("just now", "12m ago", "3h ago") in the session list and detail; they tick live every 30s so you can instantly see which agents have gone quiet.
- **Per-shell work titles** — an AI summary names *what each session is working on* (the running/waiting state is the badge's job).
- **Real in-browser terminal** — "Shell in" opens an [xterm.js](https://xtermjs.org/) terminal bridged over a WebSocket to a PTY running `tmux attach`. Type, run, Ctrl-C — like actually being in the shell.
- **Resume button** — when a pane prints a recovery command (e.g. `codex resume <id>`), a one-click button runs it.
- **Copy / Send / Paste / keys** — copy attach commands or pane output, send input to a pane (with or without Enter), plus Enter / Ctrl-C / Clear, browser-native microphone dictation, image paste/upload, privacy blur, and command history. Image paste/drop/upload works in both the composer cards and **Shell in** terminals.
- **Browser memory** — remembers the selected shell, command history, view/density/line preferences, shell order/sizes, onboarding dismissal, and floating terminal window positions in local browser storage.
- **Mobile-friendly** — one shell at a time with a sticky tab switcher; Enter sends.
- **Agent presets** — optional Create/Stop/Restart entries for iFlow/Flow, Gemini CLI, Qwen Code, goose, Aider, OpenCode, Codex, Grok, Claude Code, and custom commands.
- **Quick links & tickers** — configurable sidebar links (`DASHBOARD_LINKS`, then editable in `links.json`) to related services, plus an optional stock ticker bar (`DASHBOARD_TICKERS` + a `FINNHUB_API_KEY`, then editable in `dashboard-config.json`).
- **Configurable widgets** — Machine, remote hosts, local containers, Links, and the ticker bar can be shown/hidden from **Configure**, with JSON persistence for agent-driven setup. Remote-host widgets and quick links are fully self-service: add/edit/remove them from the sidebar (Homarr-style) without touching env or restarting.
- **Machine metrics and containers** — sidebar widgets show live CPU, CPU MHz, RAM, load average, hardware temperatures, local Docker/Podman containers, plus optional SSH-based remote host ping/container checks.
- **Safe shot** — creates a sanitized share image with shell names, commands, paths, hostnames, and output removed; copies it to the clipboard and saves it under `share/`.
- **Locked down** — primary login + a second "unlock" password to gate shell control, optional IP allowlists, and first-class support for sitting behind **Cloudflare Access** (trusts the verified email).

## Requirements

- Rust (stable) + Cargo
- `tmux`
- [Bun](https://bun.sh) or any `tsc` to build the small TypeScript frontend
- Linux (uses `/proc` for tty/foreground detection)

## Build

```sh
bun install            # or: npm install
bun run build:frontend # compiles frontend/*.ts -> public/*.js (tsc)
cargo build --release
```

## Configure

Copy `.env.example` and set at least `DASHBOARD_PASSWORD`. See that file for every option (login, IP allowlists, Cloudflare Access, the optional AI summary, quick links, and tickers).

For a real private env file, use the helper so the folder is created and the file is locked to `0600` without printing values:

```sh
scripts/shelldeck-secret --dir ~/.config/shelldeck DASHBOARD_SECRET --generate
scripts/shelldeck-secret --dir ~/.config/shelldeck DASHBOARD_PASSWORD --prompt
```

`--dir ~/.config/shelldeck` writes `~/.config/shelldeck/.env`; use `--env-file ~/.config/shelldeck/shelldeck.env` when your systemd unit points at a named `EnvironmentFile`.

`DASHBOARD_LINKS` seeds the sidebar links. Runtime edits are saved to `links.json` in `DASHBOARD_ROOT_DIR` by default, or to `DASHBOARD_LINKS_FILE` when set.

`DASHBOARD_TICKERS` seeds the ticker bar. Runtime edits and widget visibility are saved to `dashboard-config.json` in `DASHBOARD_ROOT_DIR` by default, or to `DASHBOARD_UI_CONFIG_FILE` when set.

Live quotes come from [Finnhub](https://finnhub.io) — set `FINNHUB_API_KEY` (also accepts `FINNHUB_TOKEN` / `finnhub_token`). Free tier covers US equities (`INTC`, `TSLA`, `NVDA`) and crypto: a Yahoo-style `BTC-USD` is auto-mapped to Finnhub's `COINBASE:BTC-USD`, or use an explicit `BINANCE:BTCUSDT`. When the key is unset the ticker bar shows a link to grab a free one instead of quotes.

```json
{
  "tickers": ["MSFT", "NVDA", "TSLA"],
  "panels": {
    "machine": true,
    "machineSensors": true,
    "remoteHosts": true,
    "containers": true,
    "links": true,
    "tickers": true
  }
}
```

The **Safe shot** button saves a sanitized full-dashboard PNG to `share/shelldeck-safe-shot.png` by default, or `DASHBOARD_SHARE_SHOT_FILE` when set.

`DASHBOARD_REMOTE_HOSTS` adds Homarr-style remote host widgets. ShellDeck checks these from the server using `ping` and read-only SSH container commands:

```sh
DASHBOARD_REMOTE_HOSTS=logan502vs|Logan GL502VS|logan-gl502vs
```

This env value only *seeds* `remote-hosts.json` on first run. After that, add, edit, and remove hosts from the sidebar's **Remote Hosts → Edit** button (self-service, no restart) — one `id|Label|user@host` per line. Targets are validated and a leading `-` is rejected so a value can never be parsed as an `ssh`/`ping` option. The widget shows each host's full container count (default cap 100, tune with `DASHBOARD_REMOTE_CONTAINER_CAP`) and notes "showing N" rather than silently hiding the tail.

`DASHBOARD_SSH_ATTACH_TEMPLATE` adds a per-session **SSH** button that copies a command to attach to that tmux session from another machine (e.g. `ssh logan-laptop -t 'tmux attach -t {name}'`, `{name}` = session). It's copy-only — ShellDeck never runs it — and the button hides when the template is unset.

Microphone dictation records your voice in the browser (`getUserMedia` + `MediaRecorder`) and transcribes it **on the ShellDeck host** with [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — the audio stays on your machine and is never sent to a third party. It needs a secure context (`https://` or `localhost`), `whisper-cli` + `ffmpeg` installed, and a whisper model. ShellDeck deliberately does **not** use the browser-native Web Speech API: that has no working recognition backend on Linux (Edge's is broken since v134; distro Chromium ships no Google speech key). Click **Mic** to start recording, click it again to stop and transcribe into the shell input. If no model is configured, the Mic button reports it clearly instead of failing silently.

Setup: install `ffmpeg` and `whisper-cli` (build whisper.cpp, or your distro/AUR package), then drop a model at `share/models/ggml-base.en.bin` (auto-detected) or point `DASHBOARD_STT_MODEL` at one. See `DASHBOARD_STT_*` in `.env.example`.

### Agent Presets And Open-Source CLIs

ShellDeck shows the configured slots, presets, and custom sessions by default. Set `DASHBOARD_SHOW_UNKNOWN_SESSIONS=1` only if you also want unrelated live tmux sessions to appear in the bar. If you want first-class **Create** / **Stop** / **Restart** buttons for AI coding agents, enable presets:

```sh
DASHBOARD_AGENT_WORKDIR=/home/you/repos
DASHBOARD_AGENT_PRESETS=flow,gemini,qwen,goose,aider,opencode
```

Preset mapping:

| Preset | Session | Command |
| --- | --- | --- |
| `flow` or `iflow` | `iflow` | `iflow` |
| `gemini` | `gemini` | `gemini` |
| `qwen` | `qwen` | `qwen` |
| `goose` | `goose` | `goose session` |
| `aider` | `aider` | `aider` |
| `opencode` | `opencode` | `opencode` |
| `codex` | `codex` | `codex` |
| `grok` | `grok` | `grok` |
| `claude` | `claude` | `claude` |

Custom sessions use `name|Label|badge|command` entries separated by semicolons:

```sh
DASHBOARD_CUSTOM_SESSIONS=openclaw|Open Claw|oc|openclaw;crush|Crush|cr|crush
```

Install the agents themselves normally before starting their sessions. Current common installs:

```sh
npm install -g @google/gemini-cli
npm install -g @qwen-code/qwen-code@latest
curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash
npm install -g @iflow-ai/iflow-cli
```

Note: the `flow` preset is an alias for `iflow` for existing iFlow installs or forks. iFlow's upstream hosted CLI service announced an April 17, 2026 shutdown, so use it only if your install still works; Gemini, Qwen, goose, Aider, and OpenCode are better fresh open-source defaults.

## Run

```sh
DASHBOARD_PASSWORD=... DASHBOARD_ROOT_DIR=$(pwd) ./target/release/shelldeck
```

`DASHBOARD_ROOT_DIR` must point at the folder containing `public/` (defaults to the working directory). Then open `http://127.0.0.1:8787`.

### systemd (user service)

```ini
[Service]
Type=simple
EnvironmentFile=%h/.config/shelldeck.env
Environment=DASHBOARD_ROOT_DIR=%h/shelldeck
WorkingDirectory=%h/shelldeck
ExecStart=%h/shelldeck/target/release/shelldeck
Restart=always
```

Put it behind a reverse proxy / Cloudflare Tunnel for remote access, and ideally a Cloudflare Access policy restricting to your email. When such an external layer already authenticates who can reach the dashboard, set `DASHBOARD_SKIP_LOGIN=1` to skip ShellDeck's own login password and let Cloudflare Access (or your proxy) be the front door — the shell unlock (second) password still gates shell control.

## Use

1. Sign in, then enter `DASHBOARD_UNLOCK_PASSWORD` in **Shell Unlock**. Until unlocked, pane previews, input, summaries, and live terminals stay gated.
2. Use **Send** to paste text and press Enter in a pane. Use **Paste** to insert text without pressing Enter. On mobile, plain Enter in the textarea sends; Shift+Enter inserts a newline.
3. Use **New tmux** on an offline slot to create it. Enter a tmux session name, or leave it blank to use the autogenerated slot name. Closed non-core sessions can be removed from the dashboard. Use **Copy** in the session detail to copy the configured attach command, or **Copy** on a shell card to copy that pane's captured output.
4. Use **Mic** to dictate into a shell input: click to start recording, click again to stop and transcribe (server-side whisper.cpp; needs a model configured).
5. Use **Image** or paste/drop an image onto a shell card to upload it, optimize large images for agent use, and insert the saved local path into the input box. Use **Privacy** to blur shell text without clearing it. Attachment chips clear after a successful send/paste into tmux.
6. Use **Shell in** to open a real interactive terminal. Paste/drop an image there, or use **Image**, to upload it and insert the saved file path into the live terminal input. On mobile, the terminal opens full-screen with a visible **Close x** button in the title bar.
7. Use **Configure** to edit widget visibility and stock/crypto tickers without changing env files. The **Edit tickers** button jumps straight to the same ticker config.
8. Use **Safe shot** to copy a redacted PNG to the clipboard and save the same image in the repo `share/` folder.
9. Browser memory is on by default. ShellDeck stores UI preferences, command history, cached shell previews, shell order/sizes, onboarding dismissal, and floating terminal window positions in `localStorage`; clear site data in the browser if you want to reset that memory.

## Development

The repository default branch is `master`.

```sh
bun run check
cargo test
```

If you edit files in `frontend/`, rebuild the served JavaScript before committing:

```sh
bun run build:frontend
```

### Logan laptop deploy

The Logan laptop can auto-deploy after a squash merge by polling `origin/master`
with `ops/systemd/shelldeck-auto-deploy.timer`. The watcher uses a clean cache
checkout, builds the app, installs the release binary and `public/` assets into
`/home/falk/repos/shelldeck`, restarts `shelldeck.service`, and checks
`http://127.0.0.1:8787/`. It does not reset the active development checkout.

## Security notes

- The **in-browser terminal attaches to your real tmux sessions** — anyone who can authenticate gets a shell. Treat the credentials accordingly and don't expose it unauthenticated.
- Set a strong `DASHBOARD_PASSWORD` and `DASHBOARD_UNLOCK_PASSWORD`; the defaults are placeholders.
- The Content-Security-Policy is strict (`script-src 'self'`), with `style-src 'unsafe-inline'` only because xterm.js injects a `<style>`.

## Layout

- `src/` — Rust (axum) backend: auth, tmux, SSE stream, WebSocket PTY terminal, AI summary.
- `frontend/*.ts` → `public/*.js` — the UI (no framework).
- `public/` — served assets, incl. bundled xterm.js.

## Acknowledgements

Bundles [xterm.js](https://github.com/xtermjs/xterm.js) and its fit addon (MIT).

## License

MIT — see [LICENSE](LICENSE).
