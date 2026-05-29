# ShellDeck

A small, self-hosted web dashboard to **monitor and drive your `tmux` sessions and AI coding agents** (Claude Code, Codex, opencode, Grok, …) from a browser — including a **real interactive terminal**. Single Rust binary, no database.

It was built to babysit a fleet of long-running agent sessions from a phone or a locked-down client network, but it works for any tmux setup.

## Features

- **Side-by-side shell previews** — live `tmux capture-pane` of each session, streamed over SSE (~1s), with TUI blank-line noise collapsed.
- **Running / waiting badges** — detected from the live pane: a session whose output keeps changing is "running", one that's gone quiet is "waiting for input". Works for any agent or program, with no dependence on a specific status phrase.
- **Last activity** — tmux `session_activity` timestamps are shown as friendly relative times ("just now", "12m ago", "3h ago") in the session list and detail; they tick live every 30s so you can instantly see which agents have gone quiet.
- **Per-shell work titles** — an AI summary names *what each session is working on* (the running/waiting state is the badge's job).
- **Real in-browser terminal** — "Shell in" opens an [xterm.js](https://xtermjs.org/) terminal bridged over a WebSocket to a PTY running `tmux attach`. Type, run, Ctrl-C — like actually being in the shell.
- **Resume button** — when a pane prints a recovery command (e.g. `codex resume <id>`), a one-click button runs it.
- **Copy / Send / Paste / keys** — copy attach commands or pane output, send input to a pane (with or without Enter), plus Enter / Ctrl-C / Clear, image paste, and command history. Image paste/drop works in both the composer cards and **Shell in** terminals.
- **Browser memory** — remembers the selected shell, command history, view/density/line preferences, shell order/sizes, onboarding dismissal, and floating terminal window positions in local browser storage.
- **Mobile-friendly** — one shell at a time with a sticky tab switcher; Enter sends.
- **Agent presets** — optional Start/Restart entries for iFlow/Flow, Gemini CLI, Qwen Code, goose, Aider, OpenCode, Codex, Grok, Claude Code, and custom commands.
- **Quick links & tickers** — configurable sidebar links (`DASHBOARD_LINKS`) to related services, plus an optional stock/crypto ticker bar (`DASHBOARD_TICKERS`).
- **Machine metrics** — a sidebar widget shows live CPU, RAM, load average, and hardware temperatures (read from `/proc` and `/sys/class/hwmon`) for the host ShellDeck runs on.
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

### Agent Presets And Open-Source CLIs

ShellDeck automatically shows live custom tmux sessions even when it did not start them. If you also want first-class **Start** / **Restart** buttons for AI coding agents, enable presets:

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
3. Use **Copy** in the session detail to copy the configured attach command, or **Copy** on a shell card to copy that pane's captured output.
4. Use **Image** or paste/drop an image onto a shell card to upload it, optimize large images for agent use, and insert the saved local path into the input box.
5. Use **Shell in** to open a real interactive terminal. Paste/drop an image there to upload it and insert the saved file path into the live terminal input. On mobile, the terminal opens full-screen with a visible **Close x** button in the title bar.
6. Browser memory is on by default. ShellDeck stores UI preferences and command history in `localStorage`; clear site data in the browser if you want to reset that memory.

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
