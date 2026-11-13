#!/usr/bin/env bash
# 临时公网 HTTPS 隧道：先跑 start_mobile.sh，再跑本脚本
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install Node.js 18+ first." >&2
  exit 1
fi

echo "Make sure ./mobile/start_mobile.sh is already running in another terminal."
exec node mobile/tunnel.js
