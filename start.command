#!/bin/bash

# BidMatch AI macOS launcher
# Double-click this file from Finder, or run it from Terminal.

set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1

pause_on_error() {
  echo
  read -r -p "Press Return to close this window..." _
}

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  # Common nvm location when Finder does not inherit the user's shell PATH.
  if [ -d "$HOME/.nvm/versions/node" ]; then
    candidate="$(find "$HOME/.nvm/versions/node" -type f -path '*/bin/node' 2>/dev/null | sort -V | tail -n 1)"
    if [ -n "${candidate:-}" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  fi

  return 1
}

NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "BidMatch AI V8.0.0 could not find Node.js."
  echo
  echo "Install Node.js 20 or newer, then run this launcher again."
  echo "After installing, you can confirm it in Terminal with: node --version"
  pause_on_error
  exit 1
fi

NODE_VERSION="$($NODE_BIN -p 'process.versions.node')"
NODE_MAJOR="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "BidMatch AI requires Node.js 20 or newer."
  echo "Found Node.js $NODE_VERSION at: $NODE_BIN"
  pause_on_error
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

# Prefer port 3000, but automatically move to the next free local port.
PORT_TO_USE=3000
while [ "$PORT_TO_USE" -le 3010 ]; do
  if "$NODE_BIN" -e "const net=require('net');const s=net.createServer();s.once('error',()=>process.exit(1));s.once('listening',()=>s.close(()=>process.exit(0)));s.listen($PORT_TO_USE,'127.0.0.1');" >/dev/null 2>&1; then
    break
  fi
  PORT_TO_USE=$((PORT_TO_USE + 1))
done

if [ "$PORT_TO_USE" -gt 3010 ]; then
  echo "Could not find a free local port between 3000 and 3010."
  echo "Close other local development servers and try again."
  pause_on_error
  exit 1
fi

URL="http://localhost:$PORT_TO_USE"
echo "Starting BidMatch AI V8.0.0..."
echo "Node.js: $NODE_VERSION"
echo "App folder: $APP_DIR"
echo "URL: $URL"
echo

PORT="$PORT_TO_USE" "$NODE_BIN" server.mjs &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

READY=0
for _ in $(seq 1 40); do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    echo
    echo "The BidMatch AI server stopped before it was ready."
    pause_on_error
    exit 1
  fi

  if curl -fsS "http://127.0.0.1:$PORT_TO_USE/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
done

if [ "$READY" -ne 1 ]; then
  echo
  echo "The server started but did not answer its health check."
  echo "Try opening $URL manually and keep this Terminal window open."
  pause_on_error
  exit 1
fi

echo "BidMatch AI V8.0.0 is running. Keep this Terminal window open while using the app."
echo "Opening $URL"
open "$URL" >/dev/null 2>&1 || true

echo
echo "Press Control-C to stop BidMatch AI."
wait "$SERVER_PID"
