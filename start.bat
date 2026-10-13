@echo off
title Portfolio Server
cd /d "%~dp0"
echo Starting portfolio server...
start "" http://localhost:3000
node --env-file-if-exists=.env server.js
pause
