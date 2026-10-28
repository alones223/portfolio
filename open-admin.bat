@echo off
title Portfolio admin one-click
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)
node scripts\open-site.js --admin %*
if errorlevel 1 pause
