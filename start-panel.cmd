@echo off
cd /d "%~dp0"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":5180 .*LISTENING"') do (
  echo [%date% %time%] Shiv Panel already listening on port 5180 with PID %%P >> shiv-panel.autostart.log
  exit /b 0
)

if not exist "%~dp0dist\index.html" (
  "C:\Program Files\nodejs\npm.cmd" run build >> shiv-panel.log 2>> shiv-panel.err.log
)

"%~dp0node_modules\.bin\vite.cmd" preview --host 0.0.0.0 --port 5180 --strictPort >> shiv-panel.log 2>> shiv-panel.err.log
