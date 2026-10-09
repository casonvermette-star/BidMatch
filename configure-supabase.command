#!/bin/bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1
[ -f .env ] || cp .env.example .env
find_node(){ if command -v node >/dev/null 2>&1;then command -v node;return;fi;for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node;do [ -x "$c" ]&&{ echo "$c";return;};done; }
NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then echo "Node.js 20+ was not found."; read -r -p "Press Return to close..." _; exit 1; fi
echo "BidMatch AI V8 — Supabase connection setup"
echo "This stores the connection but leaves DATA_BACKEND=local until migration is complete."
read -r -p "Supabase project URL: " SUPA_URL
read -r -s -p "Supabase secret key (sb_secret_...): " SUPA_KEY; echo
read -r -p "Private bucket (blank = bidmatch-documents): " SUPA_BUCKET
[ -n "$SUPA_BUCKET" ] || SUPA_BUCKET="bidmatch-documents"
BIDMATCH_CONFIG_MODE=supabase BIDMATCH_SUPABASE_URL="$SUPA_URL" BIDMATCH_SUPABASE_KEY="$SUPA_KEY" BIDMATCH_SUPABASE_BUCKET="$SUPA_BUCKET" "$NODE_BIN" scripts/windows/update-config.mjs
STATUS=$?
unset SUPA_KEY
if [ "$STATUS" -eq 0 ]; then
  echo
  echo "Connection saved. Next run:"
  echo "  npm run migrate:dry"
  echo "Review data/normalized-export.json, then run:"
  echo "  npm run migrate:apply"
  echo "After migration, run ./switch-to-supabase.command"
fi
read -r -p "Press Return to close..." _
exit "$STATUS"
