#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_DIR="${SHELLDECK_LIVE_DIR:-/home/falk/repos/shelldeck}"
SERVICE="${SHELLDECK_SERVICE:-shelldeck.service}"
HOSTNAME_EXPECTED="${SHELLDECK_DEPLOY_HOSTNAME:-logan-laptop}"
URL="${SHELLDECK_HEALTH_URL:-http://127.0.0.1:8787/}"
SHA="${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD)}"

if [ "$(hostname)" != "$HOSTNAME_EXPECTED" ]; then
  echo "Refusing deploy on unexpected host: $(hostname) != $HOSTNAME_EXPECTED" >&2
  exit 1
fi

if [ ! -d "$LIVE_DIR/public" ] || [ ! -d "$LIVE_DIR/target" ]; then
  echo "Refusing deploy: live ShellDeck directory is not present at $LIVE_DIR" >&2
  exit 1
fi

cd "$ROOT"
bun install --frozen-lockfile
bun run build:frontend
cargo build --release

install -m 0755 "$ROOT/target/release/shelldeck" "$LIVE_DIR/target/release/shelldeck"
rsync -a --delete "$ROOT/public/" "$LIVE_DIR/public/"
printf '%s\n' "$SHA" > "$LIVE_DIR/.deployed-sha"

systemctl --user restart "$SERVICE"
sleep 2
systemctl --user is-active --quiet "$SERVICE"
curl -fsS "$URL" >/dev/null

echo "Deployed ShellDeck $SHA to $LIVE_DIR"
