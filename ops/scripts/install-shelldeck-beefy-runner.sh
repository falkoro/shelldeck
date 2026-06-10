#!/usr/bin/env bash
# Register a persistent host runner on logan-gl502vs that deploys ShellDeck into beefy.
set -euo pipefail

RUNNER_ROOT="${SHELLDECK_BEEFY_RUNNER_ROOT:-$HOME/actions-runners/shelldeck-beefy}"
RUNNER_VERSION="${RUNNER_VERSION:-2.334.0}"
REPO="${SHELLDECK_BEEFY_RUNNER_REPO:-spot-techno/shelldeck}"
RUNNER_NAME="${SHELLDECK_BEEFY_RUNNER_NAME:-logan-gl502vs-shelldeck-beefy}"
LABELS="${SHELLDECK_BEEFY_RUNNER_LABELS:-shelldeck-beefy}"
TOKEN_FILE="${GITHUB_TOKEN_FILE:-$HOME/.config/mcp/secrets/github-mcp-token}"

read_github_token() {
  if [ -n "${GH_TOKEN:-}" ]; then
    printf '%s' "$GH_TOKEN"
    return
  fi
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    printf '%s' "$GITHUB_TOKEN"
    return
  fi
  local stored_token
  stored_token="$(gh auth token -h github.com 2>/dev/null || true)"
  if [ -n "$stored_token" ]; then
    printf '%s' "$stored_token"
    return
  fi
  if [ -r "$TOKEN_FILE" ]; then
    tr -d '\n' < "$TOKEN_FILE"
    return
  fi
  echo "No GitHub token available. Set GH_TOKEN or provide $TOKEN_FILE" >&2
  exit 1
}

case "$(hostname)" in
  logan-GL502VS|logan-gl502vs|logan-GL502VS.localdomain|logan-gl502vs.localdomain) ;;
  *)
    echo "Refusing install on unexpected host: $(hostname)" >&2
    exit 1
    ;;
esac

GH_TOKEN="$(read_github_token)"
export GH_TOKEN

mkdir -p "$(dirname "$RUNNER_ROOT")"
if [ ! -x "$RUNNER_ROOT/config.sh" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/actions-runner.tar.gz" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  mkdir -p "$RUNNER_ROOT"
  tar -xzf "$tmp/actions-runner.tar.gz" -C "$RUNNER_ROOT"
  rm -rf "$tmp"
fi

registration_token="$(gh api --method POST "repos/$REPO/actions/runners/registration-token" --jq .token)"

cd "$RUNNER_ROOT"
if [ -f .runner ]; then
  echo "Runner already configured at $RUNNER_ROOT ($(jq -r .agentName .runner 2>/dev/null || echo unknown))"
  ./svc.sh status || true
  exit 0
fi

./config.sh \
  --url "https://github.com/$REPO" \
  --token "$registration_token" \
  --name "$RUNNER_NAME" \
  --labels "$LABELS" \
  --unattended \
  --replace

unit_src="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/systemd/shelldeck-beefy-runner.service"
unit_dst="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/shelldeck-beefy-runner.service"
install -D -m 0644 "$unit_src" "$unit_dst"
systemctl --user daemon-reload
systemctl --user enable --now shelldeck-beefy-runner.service
echo "Installed $RUNNER_NAME ($LABELS) at $RUNNER_ROOT (user systemd: shelldeck-beefy-runner.service)"