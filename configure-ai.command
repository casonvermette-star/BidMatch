#!/bin/bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1
[ -f .env ] || cp .env.example .env

echo "BidMatch AI V6.1.2 — AI setup"
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
BIDMATCH_CONFIG_MODE=ai BIDMATCH_OPENAI_KEY="$API_KEY" node scripts/windows/update-config.mjs
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
