@echo off
chcp 65001 >nul
title Corre Cidade
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)
start "" http://localhost:3000
node server.js
pause
