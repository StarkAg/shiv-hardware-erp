@echo off
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" server.mjs >> shiv-print-server.log 2>> shiv-print-server.err.log
