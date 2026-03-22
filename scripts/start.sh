#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5173}"

usage() {
  cat <<'EOF'
Usage: bash scripts/start.sh [--host HOST] [--port PORT] [--install-only]

Options:
  --host HOST      Host to bind the dev server to. Default: 127.0.0.1
  --port PORT      Port to run Vite on. Default: 5173
  --install-only   Install dependencies, then exit
  -h, --help       Show this help message
EOF
}

INSTALL_ONLY=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --install-only)
      INSTALL_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install it first, or enable it with: corepack enable"
  exit 1
fi

if [ ! -d node_modules ] || [ ! -f pnpm-lock.yaml ]; then
  echo "Installing dependencies with pnpm..."
  pnpm install
fi

if [ "$INSTALL_ONLY" -eq 1 ]; then
  echo "Dependencies are ready."
  exit 0
fi

echo "Starting TyporAI on http://${HOST}:${PORT}"
exec pnpm dev --host "$HOST" --port "$PORT"
