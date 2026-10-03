#!/bin/bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1

echo "BidMatch AI V5 diagnostics"
echo "======================="
echo "Folder: $APP_DIR"
echo "macOS: $(sw_vers -productVersion 2>/dev/null || echo unknown)"
echo "Shell: $SHELL"
echo

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi
  done
fi

if [ -n "$NODE_BIN" ]; then
  echo "Node: $NODE_BIN"
  echo "Version: $($NODE_BIN --version)"
  echo
  echo "Checking JavaScript syntax..."
  "$NODE_BIN" --check server.mjs && "$NODE_BIN" --check public/app.js && echo "Syntax: OK"
else
  echo "Node: NOT FOUND"
fi

echo
for p in 3000 3001 3002; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $p: IN USE"
    lsof -nP -iTCP:$p -sTCP:LISTEN | tail -n +2
  else
    echo "Port $p: available"
  fi
done

echo
echo "If Node says NOT FOUND, install Node.js 20+ first."
echo "If Node is present, double-click start.command and leave its Terminal window open."
echo
read -r -p "Press Return to close..." _
