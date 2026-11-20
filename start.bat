@echo off
title Meme Mixer
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
start "" http://localhost:8080
node server.js
pause
