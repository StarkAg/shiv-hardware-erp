@echo off
cd /d "%~dp0"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":3333 .*LISTENING"') do (
  echo [%date% %time%] Shiv Print Server already listening on port 3333 with PID %%P >> shiv-print-server.autostart.log
  exit /b 0
)

:restart
echo [%date% %time%] Shiv Print Server starting >> shiv-print-server.log
"C:\Program Files\nodejs\node.exe" server.mjs >> shiv-print-server.log 2>> shiv-print-server.err.log
echo [%date% %time%] Shiv Print Server exited (code %errorlevel%), restarting in 5s >> shiv-print-server.log
timeout /t 5 /nobreak > nul
goto restart
