#!/usr/bin/env bash
set -euo pipefail

export PATH="${BUN_HOME:-$HOME/.bun}/bin:${CARGO_HOME:-$HOME/.cargo}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
# beefy-personal container aliases `cc` to Claude; force a real compiler for cargo.
if command -v /usr/sbin/gcc >/dev/null 2>&1; then
  export CC="${CC:-/usr/sbin/gcc}"
  export CXX="${CXX:-/usr/sbin/g++}"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_DIR="${SHELLDECK_LIVE_DIR:-/home/falk/repos/shelldeck}"
SERVICE="${SHELLDECK_SERVICE:-shelldeck.service}"
HOSTNAME_EXPECTED="${SHELLDECK_DEPLOY_HOSTNAME:-logan-laptop}"
URL="${SHELLDECK_HEALTH_URL:-http://127.0.0.1:8787/}"
PUBLIC_URLS="${SHELLDECK_PUBLIC_URLS:-}"
case "$HOSTNAME_EXPECTED" in
  cachy-beefy) PUBLIC_URLS="${PUBLIC_URLS:-https://code.falkinator.org/}" ;;
  logan-laptop) PUBLIC_URLS="${PUBLIC_URLS:-https://code.spotcloud.nl/}" ;;
esac
SHA="${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD)}"

deploy_host_ok() {
  [ "$(hostname)" = "$HOSTNAME_EXPECTED" ] && return 0
  # beefy-personal runs ShellDeck in a container whose hostname is the container id,
  # but DASHBOARD_HOSTNAME in shelldeck.env still identifies it as cachy-beefy.
  if [ "$HOSTNAME_EXPECTED" = "cachy-beefy" ] && [ -r "${HOME}/.config/shelldeck.env" ]; then
    local dashboard_hostname
    dashboard_hostname="$(grep -E '^DASHBOARD_HOSTNAME=' "${HOME}/.config/shelldeck.env" | head -1 | cut -d= -f2- | tr -d '[:space:]')"
    [ "$dashboard_hostname" = "cachy-beefy" ] && return 0
  fi
  return 1
}

if ! deploy_host_ok; then
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

if systemctl --user restart "$SERVICE" 2>/dev/null; then
  sleep 2
  systemctl --user is-active --quiet "$SERVICE"
else
  pkill -u "$(id -un)" -f "${LIVE_DIR}/target/release/shelldeck" 2>/dev/null || true
  sleep 2
  if [ -x "${HOME}/.local/bin/start-shelldeck-container" ]; then
    nohup "${HOME}/.local/bin/start-shelldeck-container" >> "${HOME}/.local/state/shelldeck-container.log" 2>&1 &
  else
    nohup "${LIVE_DIR}/target/release/shelldeck" >> "${HOME}/.local/state/shelldeck-container.log" 2>&1 &
  fi
  sleep 2
fi
curl -fsS "$URL" >/dev/null

IFS=',' read -r -a public_urls <<< "$PUBLIC_URLS"
for public_url in "${public_urls[@]}"; do
  public_url="${public_url#"${public_url%%[![:space:]]*}"}"
  public_url="${public_url%"${public_url##*[![:space:]]}"}"
  [ -n "$public_url" ] || continue
  code="$(curl -fsS -o /dev/null -w '%{http_code}' "$public_url" || true)"
  case "$code" in
    200|302|401|403) ;;
    *)
      echo "Public ShellDeck check failed for $public_url (HTTP $code)" >&2
      exit 1
      ;;
  esac
done

echo "Deployed ShellDeck $SHA to $LIVE_DIR"