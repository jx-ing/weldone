@echo off
setlocal
cd /d "%~dp0"
set "WELDONE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%WELDONE_NODE%" goto run
where node >nul 2>nul
if errorlevel 1 goto missing
set "WELDONE_NODE=node"
:run
"%WELDONE_NODE%" scripts\launch.mjs
if errorlevel 1 pause
exit /b
:missing
echo Node.js is required to start this platform.
pause
