#!/bin/bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1
find_node(){ if command -v node >/dev/null 2>&1; then command -v node; return 0; fi; for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do [ -x "$c" ] && { echo "$c"; return 0; }; done; return 1; }
NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then echo "Node.js 20+ was not found."; read -r -p "Press Return to close..." _; exit 1; fi
"$NODE_BIN" scripts/verify-production.mjs
STATUS=$?
echo
read -r -p "Press Return to close..." _
exit "$STATUS"
