#!/usr/bin/env bash
# Deploy ShellDeck into the beefy-personal container on logan-laptop.
#
# The container is ROOTFUL podman (needs sudo; the runner user has passwordless sudo for podman).
# Its /home/falk is bind-mounted from the host's $BEEFY_HOME, so the staging dir and the in-container
# live dir are shared host<->container through that mount — we stage on the host, build in the
# container (its own toolchain/glibc), and install into the live dir, all over the same files.
set -euo pipefail

ROOT="${1:?source checkout required}"
SHA="${2:?commit sha required}"

BEEFY_HOME="${SHELLDECK_BEEFY_HOME:-/home/falk/beefy-home}"
CONTAINER="${SHELLDECK_BEEFY_CONTAINER:-beefy-personal}"
LIVE_DIR="${SHELLDECK_BEEFY_LIVE_DIR:-/home/falk/repos/shelldeck}"   # path INSIDE the container
HEALTH_URL="${SHELLDECK_HEALTH_URL:-http://127.0.0.1:8789/}"
STAGING="${BEEFY_HOME}/.cache/shelldeck-deploy-staging"             # host path == container /home/falk/.cache/...
PODMAN=(sudo podman)                                                # rootful container

mkdir -p "$STAGING"
rsync -a --delete \
  --exclude target \
  --exclude node_modules \
  --exclude .git \
  "$ROOT/" "$STAGING/"

# Build + install inside the container (blocking). No restart here.
"${PODMAN[@]}" exec -u falk -i "$CONTAINER" bash -s -- "$SHA" "$LIVE_DIR" <<'EOF'
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

# Stop the running dashboard so the restart can rebind :8787.
pkill -u falk -f "$LIVE_DIR/target/release/shelldeck" >/dev/null 2>&1 || true
EOF

# Restart DETACHED: start-shelldeck-container execs the binary in the foreground, so a blocking
# `podman exec` would hang the job until timeout. `-d` returns immediately and leaves it running.
sleep 1
"${PODMAN[@]}" exec -d -u falk -e HOME=/home/falk "$CONTAINER" \
  bash -lc 'exec /home/falk/.local/bin/start-shelldeck-container'

# Health check from the host (container publishes :8789 -> :8787). Accept any "server is up"
# response (the dashboard may 302 to login or 403 a non-allowlisted source — all mean it booted).
for _ in $(seq 1 15); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || true)"
  case "$code" in
    200|302|401|403)
      echo "Deployed ShellDeck $SHA to beefy ($LIVE_DIR via $CONTAINER) — health $code"
      exit 0
      ;;
  esac
  sleep 2
done
echo "ShellDeck health check failed at $HEALTH_URL after restart (last code: ${code:-none})" >&2
exit 1
