@echo off
cd /d "%~dp0"

:watch
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":5181 .*LISTENING"') do (
  echo [%date% %time%] Shiv Panel already listening on port 5181 with PID %%P >> shiv-panel.autostart.log
  timeout /t 30 /nobreak > nul
  goto watch
)

:loop
echo [%date% %time%] Starting Shiv Panel... >> shiv-panel.autostart.log

if not exist "%~dp0dist\index.html" (
  "C:\Program Files\nodejs\npm.cmd" run build >> shiv-panel.log 2>> shiv-panel.err.log
)

"C:\Program Files\nodejs\node.exe" "%~dp0panel-http-server.mjs" >> shiv-panel.log 2>> shiv-panel.err.log

echo [%date% %time%] Shiv Panel exited, restarting in 3s... >> shiv-panel.autostart.log
timeout /t 3 /nobreak > nul
goto loop
