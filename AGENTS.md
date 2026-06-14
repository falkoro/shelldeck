# AGENTS.md

## Memory (standing rules — always follow)

Falk expects agents to **persist** these rules here (and in Cursor memory when available), not just remember them for one chat.

1. **Never merge a PR** until all three are green: **Build and test** (CI), **Claude merge gate**, **Grok merge gate**. If any check is yellow, **wait** (gates poll up to ~15 min). Do not merge around reviewers — Falk called this out explicitly after #73 merged too early.
2. **When Falk gives a standing instruction** ("always…", "never…", "remember…"), **add it to this Memory section** in the same PR or a quick follow-up commit so the next agent sees it.
3. **Shell slots are numbered only** (`1`, `2`, `3`…) — no `main` / `slotN` layout.
4. **When all three merge checks are green, squash-merge the PR** — Falk expects agents to land it without waiting for a separate "merge now" prompt.
5. **Shell card input is always visible** — never hide `.shell-composer` on grid cards. Layout order: `header` → **composer (input)** → `pre` (pane output). Input stays **above** the log, not below.
6. **After ShellDeck UI/frontend changes, always restart the live service** on beefy (`systemctl --user restart shelldeck` after `bun run build:frontend` and `cargo build --release` when Rust changed). Falk should not need a manual hard-refresh to see CSS/layout fixes land.

## Workflow

- Work on a feature branch. Do not commit directly to `main` or `master`.
- Keep fixes in the same branch and PR until the change is actually green and usable.
- Open a GitHub PR for completed work, make requested fixes, and keep updating the PR rather than starting disconnected follow-up branches.
- Do **not** squash-merge until **CI**, **Claude merge gate**, and **Grok merge gate** are green (same spot-tech pattern: gates wait up to 15 minutes for the reviewer jobs to finish). If a gate is still yellow, wait — do not merge around it.
- Squash-merge as soon as those three checks are green (see Memory #4); use a different merge strategy only if Falk explicitly asks.
- After merging, verify the deployed/service state when this repo changes ShellDeck behavior.

## Safety

- Do not commit API keys, OAuth tokens, SSH keys, local auth files, shell histories, logs, screenshots, or generated uploads.
- Treat `~/.config/shelldeck*.env`, Cloudflare credentials, GitHub tokens, and Finnhub keys as local-only secrets.
- Preserve running tmux sessions unless Falk explicitly says they can be killed.

## Deploy and runners (internal — do not duplicate in README)

Public dashboards: `code.falkinator.org` (personal) and `code.spotcloud.nl` (Spot/work).

After squash merge to `master`, `.github/workflows/deploy-host.yml` deploys both hosts.
Operator scripts live under `ops/scripts/` and `scripts/deploy-host*.sh`.

| Machine | Labels | Role |
|---|---|---|
| **logan-gl502vs** | `logan-gl502vs`, `shelldeck-review`, `shelldeck-beefy` | Personal `falkoro/*` CI + PR CI (Grok/Claude review gates run here) |
| **spot-tech-ci** | `spot-tech-ci` | `spot-techno/*` org product CI/deploys |
| **personal** (isolated Arch **Incus system container** on **logan-laptop**) | — | `code.falkinator.org` runtime target — unprivileged, own disk (no host bind-mount). ShellDeck runs as `shelldeck.service`; host publishes container `:8787`→`:8789` via an incus proxy. No GitHub runner inside; deployed into via `incus exec` from the laptop's `shelldeck-host` runner |
| **logan-laptop** | `shelldeck-host` | Deploys BOTH dashboards: `code.spotcloud.nl` (systemd `--user` service) and `code.falkinator.org` (the `personal` Incus container) |

Install host runners once (on the named machines):

```sh
# logan-laptop → both dashboards (code.spotcloud.nl service + code.falkinator.org container)
bash ops/scripts/install-shelldeck-host-runner.sh

# logan-gl502vs → PR CI + review gates only (no longer the falkinator deploy driver)
bash ops/scripts/install-shelldeck-beefy-runner.sh
```

Do not use legacy `logan-laptop` / `beefy` / `podman` runner labels in new workflows.

## Local Checks

- Run `cargo fmt` after Rust changes.
- Run `cargo test` for backend changes.
- Run `npm run build:frontend` or `bun run build:frontend` for frontend changes, matching the machine setup.
- Rebuild `cargo build --release` before restarting the live ShellDeck service.
- After frontend/CSS changes: `bun run build:frontend`, then `systemctl --user restart shelldeck` (see Memory #6).