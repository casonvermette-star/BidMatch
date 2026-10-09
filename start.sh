#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env ]; then cp .env.example .env; fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install Node.js, then run ./start.sh again."
  exit 1
fi
MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$MAJOR" -lt 20 ]; then
  echo "Node.js 20+ is required. Found $(node --version)."
  exit 1
fi
node server.mjs
