@echo off
setlocal
REM Restart process if it is running in a hidden window with start-dashboard.vbs

set "PROJECT_DIR=%~dp0"
set "PID_FILE=%PROJECT_DIR%logs\office-dashboard.pid"

if not exist "%PID_FILE%" (
    echo Office Dashboard is not running.
) else (
    set /p PID=<"%PID_FILE%"

    if not defined PID (
        del "%PID_FILE%"
        exit /b 1
    )

    taskkill /PID %PID% /T /F >nul 2>&1

    del "%PID_FILE%" 2>nul

    echo Office Dashboard stopped.
)

echo Starting Office Dashboard.
wscript.exe start-dashboard.vbs

endlocal