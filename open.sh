#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install from https://nodejs.org"
  read -r -p "Press Enter to close…"
  exit 1
fi
exec node scripts/open-site.js "$@"