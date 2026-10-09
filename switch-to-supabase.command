#!/bin/bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)";cd "$APP_DIR"||exit 1
NODE_BIN="$(command -v node 2>/dev/null || true)";[ -n "$NODE_BIN" ]||NODE_BIN="/opt/homebrew/bin/node"
if [ ! -x "$NODE_BIN" ];then echo "Node.js 20+ was not found.";read -r -p "Press Return to close..." _;exit 1;fi
"$NODE_BIN" scripts/set-data-backend.mjs supabase
STATUS=$?
[ "$STATUS" -eq 0 ]&&echo "DATA_BACKEND=supabase is enabled. Restart BidMatch AI."
read -r -p "Press Return to close..." _
exit "$STATUS"
