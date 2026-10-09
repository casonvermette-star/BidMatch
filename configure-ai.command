#!/bin/bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1
[ -f .env ] || cp .env.example .env

find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do [ -x "$candidate" ] && { echo "$candidate"; return 0; }; done
  if [ -d "$HOME/.nvm/versions/node" ]; then
    candidate="$(find "$HOME/.nvm/versions/node" -type f -path '*/bin/node' 2>/dev/null | sort -V | tail -n 1)"
    [ -n "${candidate:-}" ] && [ -x "$candidate" ] && { echo "$candidate"; return 0; }
  fi
  return 1
}
NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then echo "Node.js 20+ was not found."; read -r -p "Press Return to close..." _; exit 1; fi


echo "BidMatch AI V8.0.0 — AI setup"
echo "================================"
echo "This updates only the AI settings in this local app folder (.env)."
echo
read -r -s -p "Paste your OpenAI API key (input is hidden): " API_KEY
echo
if [ -z "$API_KEY" ]; then
  echo "No key entered. Nothing changed."
  read -r -p "Press Return to close..." _
  exit 0
fi
BIDMATCH_CONFIG_MODE=ai BIDMATCH_OPENAI_KEY="$API_KEY" "$NODE_BIN" scripts/windows/update-config.mjs
STATUS=$?
unset API_KEY
if [ "$STATUS" -ne 0 ]; then
  echo "AI configuration failed."
  read -r -p "Press Return to close..." _
  exit "$STATUS"
fi
echo
echo "AI configuration saved. Restart BidMatch AI."
read -r -p "Press Return to close..." _
