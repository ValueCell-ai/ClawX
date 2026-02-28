@echo off
setlocal

if /i "%1"=="update" (
    echo openclaw is managed by ClawX ^(bundled version^).
    echo.
    echo To update openclaw, update ClawX:
    echo   Open ClawX ^> Settings ^> Check for Updates
    echo   Or download the latest version from https://claw-x.com
    exit /b 0
)

set ELECTRON_RUN_AS_NODE=1
set OPENCLAW_EMBEDDED_IN=ClawX
"%~dp0..\..\ClawX.exe" "%~dp0..\openclaw\openclaw.mjs" %*
endlocal
