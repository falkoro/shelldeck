#!/usr/bin/env bash
set -euo pipefail

export PATH="${BUN_HOME:-$HOME/.bun}/bin:${CARGO_HOME:-$HOME/.cargo}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

REMOTE="${SHELLDECK_DEPLOY_REMOTE:-https://github.com/falkoro/shelldeck.git}"
BRANCH="${SHELLDECK_DEPLOY_BRANCH:-master}"
STATE_DIR="${SHELLDECK_DEPLOY_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/shelldeck}"
SOURCE_DIR="${SHELLDECK_DEPLOY_SOURCE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/shelldeck/deploy-source}"
STATE_FILE="$STATE_DIR/deployed-$BRANCH.sha"
LOCK_FILE="$STATE_DIR/deploy.lock"

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

remote_sha="$(git ls-remote "$REMOTE" "refs/heads/$BRANCH" | awk '{print $1}')"
if [[ ! "$remote_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Could not resolve $REMOTE refs/heads/$BRANCH" >&2
  exit 1
fi

current_sha="$(cat "$STATE_FILE" 2>/dev/null || true)"
if [ "$current_sha" = "$remote_sha" ]; then
  echo "ShellDeck $BRANCH already deployed at $remote_sha"
  exit 0
fi

if [ -d "$SOURCE_DIR/.git" ]; then
  git -C "$SOURCE_DIR" remote set-url origin "$REMOTE"
  git -C "$SOURCE_DIR" fetch --depth 1 origin "$BRANCH"
else
  if [ -e "$SOURCE_DIR" ]; then
    echo "Refusing deploy: $SOURCE_DIR exists but is not a git checkout" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$SOURCE_DIR")"
  git clone --depth 1 --branch "$BRANCH" "$REMOTE" "$SOURCE_DIR"
fi

git -C "$SOURCE_DIR" checkout -q --detach "$remote_sha"
GITHUB_SHA="$remote_sha" "$SOURCE_DIR/scripts/deploy-logan-laptop.sh"
printf '%s\n' "$remote_sha" > "$STATE_FILE"
