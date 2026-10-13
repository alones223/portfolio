@echo off
title Portfolio Admin
cd /d "%~dp0"
echo Starting portfolio server...
start "" http://localhost:3000/admin
node --env-file-if-exists=.env server.js
pause
