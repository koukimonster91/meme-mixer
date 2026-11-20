@echo off
title Meme Mixer (demo with mock Tesira)
cd /d "%~dp0"
start "Mock Tesira" /min node mock-tesira.js 2323
set MIXER_CONFIG=config.demo.json
start "" http://localhost:8081
node server.js
pause
