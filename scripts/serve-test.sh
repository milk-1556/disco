#!/usr/bin/env bash
# Bring up the full Disco stack for testing on this box: API (:4000) + worker + the production web
# build served by `vite preview` (:4173, proxies /api → API). Native Postgres16 + Redis must be up
# (brew services). Logs land in /tmp/disco-*.log. Stop with: scripts/stop-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/opt/homebrew/opt/redis/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"
export DATABASE_URL="${DATABASE_URL:-postgresql://disco:disco@localhost:5432/disco?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export SESSION_SECRET="${SESSION_SECRET:-devsecret}"
export STORAGE_DISK_PATH="${STORAGE_DISK_PATH:-/tmp/disco-storage}"
export WEB_ORIGIN="${WEB_ORIGIN:-*}"
export API_PORT="${API_PORT:-4000}"
export PREVIEW_PORT="${PREVIEW_PORT:-4173}"

# stop any stale instances first
pkill -f "@disco/api" 2>/dev/null || true
pkill -f "@disco/worker" 2>/dev/null || true
pkill -f "vite preview" 2>/dev/null || true
sleep 1

echo "→ ensuring web build is current"
pnpm --filter @disco/web build >/tmp/disco-build.log 2>&1

echo "→ starting API on :$API_PORT"
( pnpm --filter @disco/api start >/tmp/disco-api.log 2>&1 & )
echo "→ starting worker"
( pnpm --filter @disco/worker start >/tmp/disco-worker.log 2>&1 & )
echo "→ serving web build on :$PREVIEW_PORT"
( pnpm --filter @disco/web preview >/tmp/disco-web.log 2>&1 & )

sleep 5
echo "→ health:"; curl -s "http://localhost:$API_PORT/health" || echo "(api not up yet — check /tmp/disco-api.log)"
echo
echo "Local:  http://localhost:$PREVIEW_PORT"
echo "Login:  operator@disco.local / disco"
