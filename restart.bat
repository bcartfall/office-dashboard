@echo off
setlocal EnableDelayedExpansion
REM Restart process if it is running in a hidden window with start-dashboard.vbs

set "PROJECT_DIR=%~dp0"
set "PID_FILE=%PROJECT_DIR%data\office-dashboard.pid"

echo "Checking if office-dashboard is running."

if exist "%PID_FILE%" (
    set /p "PID="<"%PID_FILE%"
    echo PID: !PID!

    taskkill /PID !PID! /T /F
    del "%PID_FILE%"

    echo Office Dashboard stopped.
) else (
    echo PID file does not exist.
)

echo Starting Office Dashboard.
wscript.exe start.vbs

pause

endlocal