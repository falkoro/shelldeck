#!/usr/bin/env bash
# Back-compat wrapper — prefer scripts/deploy-host.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/scripts/deploy-host.sh" "$@"