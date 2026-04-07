#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5173}"
API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-3001}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"

usage() {
  cat <<'EOF'
Usage: bash scripts/start.sh [--host HOST] [--port PORT] [--install-only]

Options:
  --host HOST      Host to bind the dev server to. Default: 127.0.0.1
  --port PORT      Port to run Vite on. Default: 5173
  --api-host HOST  Host to bind the backend to. Default: 127.0.0.1
  --api-port PORT  Port to run the backend on. Default: 3001
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
    --api-host)
      API_HOST="${2:-}"
      shift 2
      ;;
    --api-port)
      API_PORT="${2:-}"
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

pnpm exec tsc -p tsconfig.server.json

cleanup() {
  if [ -n "${TSC_PID:-}" ]; then
    kill "$TSC_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

ensure_port_free() {
  local port="$1"
  local label="$2"
  local pids

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return 0
  fi

  echo "$label port $port is already in use."
  echo "Stop the existing process, or start with a different port:"
  echo "  bash start.sh --api-port 3002 --port 5174"
  exit 1
}

ensure_port_free "$API_PORT" "Backend"
ensure_port_free "$PORT" "Frontend"

echo "Starting TyporAI backend on http://${API_HOST}:${API_PORT}"
echo "Admin login: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}"
API_HOST="$API_HOST" API_PORT="$API_PORT" pnpm exec tsc -p tsconfig.server.json --watch --preserveWatchOutput &
TSC_PID=$!

API_HOST="$API_HOST" API_PORT="$API_PORT" node --watch .server-dist/server/index.js &
SERVER_PID=$!

echo "Starting TyporAI frontend on http://${HOST}:${PORT}"
API_PORT="$API_PORT" exec pnpm dev:client --host "$HOST" --port "$PORT"
