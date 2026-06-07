# AGENTS.md

## Workflow

- Work on a feature branch. Do not commit directly to `main` or `master`.
- Keep fixes in the same branch and PR until the change is actually green and usable.
- Open a GitHub PR for completed work, make requested fixes, and keep updating the PR rather than starting disconnected follow-up branches.
- Squash merge after review/CI is clean unless Falk explicitly asks for a different merge strategy.
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
