#!/usr/bin/env bash
# 启动医学文献系统手机版：Streamlit + PWA 网关
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install Node.js 18+ first." >&2
  exit 1
fi

echo "Starting MedLit mobile edition... (Ctrl+C to stop)"
exec node mobile/start.js
