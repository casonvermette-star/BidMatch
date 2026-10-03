#!/bin/bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1

pause_on_error(){ echo; read -r -p "Press Return to close this window..." _; }
find_node(){
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do [ -x "$candidate" ] && { echo "$candidate"; return 0; }; done
  if [ -d "$HOME/.nvm/versions/node" ]; then
    candidate="$(find "$HOME/.nvm/versions/node" -type f -path '*/bin/node' 2>/dev/null | sort -V | tail -n 1)"
    [ -n "${candidate:-}" ] && [ -x "$candidate" ] && { echo "$candidate"; return 0; }
  fi
  return 1
}
NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then echo "BidMatch AI V6.1.2 could not find Node.js."; pause_on_error; exit 1; fi
[ -f .env ] || cp .env.example .env

# Reuse an already-running V6.1+ server only when it actually exposes
# the separate Platform Admin application. Older BidMatch versions may
# answer /api/health but do not have /admin, so do not reuse them.
for PORT_CHECK in $(seq 3000 3010); do
  HEALTH="$(curl -fsS "http://127.0.0.1:$PORT_CHECK/api/health" 2>/dev/null || true)"
  if printf '%s' "$HEALTH" | grep -Eq '"version":"6\.1(\.[0-9]+)?"' && \
     curl -fsS "http://127.0.0.1:$PORT_CHECK/admin" 2>/dev/null | grep -q 'SEPARATE ADMIN CONSOLE'; then
    URL="http://localhost:$PORT_CHECK/admin"
    echo "Using the existing BidMatch V6.1 admin server at $URL"
    open "$URL" >/dev/null 2>&1 || true
    exit 0
  fi
done

PORT_TO_USE=3000
while [ "$PORT_TO_USE" -le 3010 ]; do
  if "$NODE_BIN" -e "const net=require('net');const s=net.createServer();s.once('error',()=>process.exit(1));s.once('listening',()=>s.close(()=>process.exit(0)));s.listen($PORT_TO_USE,'127.0.0.1');" >/dev/null 2>&1; then break; fi
  PORT_TO_USE=$((PORT_TO_USE+1))
done
if [ "$PORT_TO_USE" -gt 3010 ]; then echo "No free local port found."; pause_on_error; exit 1; fi

URL="http://localhost:$PORT_TO_USE/admin"
echo "Starting BidMatch AI V6.1.2 Platform Admin..."
echo "Admin URL: $URL"
PORT="$PORT_TO_USE" "$NODE_BIN" server.mjs & SERVER_PID=$!
cleanup(){ kill "$SERVER_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$PORT_TO_USE/api/health" >/dev/null 2>&1 && break
  kill -0 "$SERVER_PID" >/dev/null 2>&1 || { echo "Server stopped before it was ready."; pause_on_error; exit 1; }
  sleep .25
done
open "$URL" >/dev/null 2>&1 || true
echo "Keep this Terminal window open. Press Control-C to stop BidMatch AI."
wait "$SERVER_PID"
