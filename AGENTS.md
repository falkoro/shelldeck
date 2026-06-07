# AGENTS.md

## Memory (standing rules — always follow)

Falk expects agents to **persist** these rules here (and in Cursor memory when available), not just remember them for one chat.

1. **Never merge a PR** until all three are green: **Build and test** (CI), **Claude merge gate**, **Grok merge gate**. If any check is yellow, **wait** (gates poll up to ~15 min). Do not merge around reviewers — Falk called this out explicitly after #73 merged too early.
2. **When Falk gives a standing instruction** ("always…", "never…", "remember…"), **add it to this Memory section** in the same PR or a quick follow-up commit so the next agent sees it.
3. **Shell slots are numbered only** (`1`, `2`, `3`…) — no `main` / `slotN` layout.
4. **When all three merge checks are green, squash-merge the PR** — Falk expects agents to land it without waiting for a separate "merge now" prompt.

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

## Local Checks

- Run `cargo fmt` after Rust changes.
- Run `cargo test` for backend changes.
- Run `npm run build:frontend` or `bun run build:frontend` for frontend changes, matching the machine setup.
- Rebuild `cargo build --release` before restarting the live ShellDeck service.