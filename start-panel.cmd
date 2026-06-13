@echo off
cd /d "%~dp0"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":5180 .*LISTENING"') do (
  echo [%date% %time%] Shiv Panel already listening on port 5180 with PID %%P >> shiv-panel.autostart.log
  exit /b 0
)

:loop
echo [%date% %time%] Starting Shiv Panel... >> shiv-panel.autostart.log

if not exist "%~dp0dist\index.html" (
  "C:\Program Files\nodejs\npm.cmd" run build >> shiv-panel.log 2>> shiv-panel.err.log
)

"%~dp0node_modules\.bin\vite.cmd" preview --host 0.0.0.0 --port 5180 --strictPort >> shiv-panel.log 2>> shiv-panel.err.log

echo [%date% %time%] Shiv Panel exited, restarting in 3s... >> shiv-panel.autostart.log
timeout /t 3 /nobreak > nul
goto loop
