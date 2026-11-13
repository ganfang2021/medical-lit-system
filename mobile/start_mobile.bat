@echo off
chcp 65001 >nul
title MedLit Mobile
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ first.
  pause
  exit /b 1
)

echo Starting MedLit mobile edition...
echo Press Ctrl+C to stop both services.
echo.
node mobile\start.js
pause
