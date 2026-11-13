@echo off
chcp 65001 >nul
title MedLit HTTPS Tunnel
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ first.
  pause
  exit /b 1
)

echo Make sure "node mobile/start.js" is already running in another window.
node mobile\tunnel.js
pause
