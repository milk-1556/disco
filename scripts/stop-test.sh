#!/usr/bin/env bash
# Stop the Disco test stack (API + worker + web preview + any Disco quick-tunnel).
pkill -f "@disco/api" 2>/dev/null || true
pkill -f "@disco/worker" 2>/dev/null || true
pkill -f "vite preview" 2>/dev/null || true
pkill -f "cloudflared tunnel --url" 2>/dev/null || true
echo "stopped Disco test stack"
