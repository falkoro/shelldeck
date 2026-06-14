#!/usr/bin/env bash
# Deploy ShellDeck into the beefy Incus container (code.falkinator.org) on logan-laptop.
#
# "beefy" is now an ISOLATED Arch Incus *system container* named "personal": unprivileged
# (container-root maps to an unprivileged host uid, not host root) with its OWN disk — there is
# NO host bind-mount of the home, so host and container are decoupled ("a separate computer").
# Because nothing is shared, we push the source INTO the container over `incus exec` (a tar
# stream), build with the container's own toolchain, install into the live dir, and restart the
# shelldeck systemd service. The host publishes the container's :8787 on :8789 via an incus proxy
# device, so the Cloudflare tunnel for code.falkinator.org is unchanged.
#
# Replaces the previous rootful-podman + bind-mount model.
set -euo pipefail

ROOT="${1:?source checkout required}"
SHA="${2:?commit sha required}"

# Use `sudo incus` by default: the shelldeck-host runner is a `systemctl --user` service whose
# user-manager captured falk's groups before falk joined `incus-admin`, so the runner can't reach
# the incus socket directly. falk has NOPASSWD sudo (same as the old `sudo podman` model), so this
# is robust regardless of the manager's stale group set. Override with SHELLDECK_INCUS_CMD=incus.
read -ra INCUS <<< "${SHELLDECK_INCUS_CMD:-sudo incus}"
CONTAINER="${SHELLDECK_BEEFY_CONTAINER:-personal}"
LIVE_DIR="${SHELLDECK_BEEFY_LIVE_DIR:-/home/falk/repos/shelldeck}"  # path INSIDE the container
SERVICE="${SHELLDECK_BEEFY_SERVICE:-shelldeck.service}"
HEALTH_URL="${SHELLDECK_HEALTH_URL:-http://127.0.0.1:8789/}"        # host proxy -> container :8787

exec_falk() {
  # Run a command in the container as the unprivileged falk user with a login env.
  "${INCUS[@]}" exec "$CONTAINER" --user 1000 --group 1000 \
    --env HOME=/home/falk --env LIVE_DIR="$LIVE_DIR" --env SHA="$SHA" -- bash -lc "$1"
}

echo "Pushing source into container '$CONTAINER' (no shared mount) ..."
tar -C "$ROOT" -cf - --exclude=target --exclude=node_modules --exclude=.git . \
  | "${INCUS[@]}" exec "$CONTAINER" --user 1000 --group 1000 --env HOME=/home/falk -- \
      bash -lc 'rm -rf ~/build/shelldeck && mkdir -p ~/build/shelldeck && tar -C ~/build/shelldeck -xf -'

echo "Building + installing in container ..."
exec_falk '
  set -euo pipefail
  export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"
  cd ~/build/shelldeck
  bun install --frozen-lockfile
  bun run build:frontend
  cargo build --release
  install -d "$LIVE_DIR/target/release"
  install -m 0755 target/release/shelldeck "$LIVE_DIR/target/release/shelldeck"
  rsync -a --delete public/ "$LIVE_DIR/public/"
  printf "%s\n" "$SHA" > "$LIVE_DIR/.deployed-sha"
'

echo "Restarting $SERVICE ..."
"${INCUS[@]}" exec "$CONTAINER" -- systemctl restart "$SERVICE"

# Health check from the host (incus proxy publishes container :8787 -> host :8789). Accept any
# "server is up" response (the dashboard may 302 to login or 403 a non-allowlisted source).
for _ in $(seq 1 15); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || true)"
  case "$code" in
    200|302|401|403)
      echo "Deployed ShellDeck $SHA to beefy ($LIVE_DIR via incus '$CONTAINER') — health $code"
      exit 0
      ;;
  esac
  sleep 2
done
echo "ShellDeck health check failed at $HEALTH_URL after restart (last code: ${code:-none})" >&2
exit 1
