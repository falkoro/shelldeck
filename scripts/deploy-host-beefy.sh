#!/usr/bin/env bash
# Deploy ShellDeck into the beefy-personal container from logan-gl502vs.
set -euo pipefail

ROOT="${1:?source checkout required}"
SHA="${2:?commit sha required}"

BEEFY_HOME="${SHELLDECK_BEEFY_HOME:-/home/logan/beefy-home}"
CONTAINER="${SHELLDECK_BEEFY_CONTAINER:-beefy-personal}"
LIVE_DIR="${SHELLDECK_LIVE_DIR:-/home/falk/repos/shelldeck}"
STAGING="${BEEFY_HOME}/.cache/shelldeck-deploy-staging"
HEALTH_URL="${SHELLDECK_HEALTH_URL:-http://127.0.0.1:8789/}"

mkdir -p "$(dirname "$STAGING")"
rsync -a --delete \
  --exclude target \
  --exclude node_modules \
  --exclude .git \
  "$ROOT/" "$STAGING/"

docker exec -u falk -i "$CONTAINER" bash -s -- "$SHA" "$LIVE_DIR" <<'EOF'
set -euo pipefail
SHA="$1"
LIVE_DIR="$2"
STAGING="/home/falk/.cache/shelldeck-deploy-staging"
export PATH="/home/falk/.bun/bin:/home/falk/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cd "$STAGING"
bun install --frozen-lockfile
bun run build:frontend
cargo build --release

install -d "$LIVE_DIR/target/release" "$LIVE_DIR/public"
install -m 0755 "$STAGING/target/release/shelldeck" "$LIVE_DIR/target/release/shelldeck"
rsync -a --delete "$STAGING/public/" "$LIVE_DIR/public/"
printf '%s\n' "$SHA" > "$LIVE_DIR/.deployed-sha"

pkill -u falk -f "$LIVE_DIR/target/release/shelldeck" >/dev/null 2>&1 || true
sleep 1
nohup "$HOME/.local/bin/start-shelldeck-container" >>"$HOME/.local/state/shelldeck-container.log" 2>&1 &
sleep 2
curl -fsS http://127.0.0.1:8787/ >/dev/null
EOF

curl -fsS "$HEALTH_URL" >/dev/null
echo "Deployed ShellDeck $SHA to beefy ($LIVE_DIR via $CONTAINER)"