@echo off
REM hipp0 CLI Windows shim. Invokes Node against the dist entry point.
REM Requires Node 22+ on PATH. Install via `choco install nodejs-lts`,
REM `winget install OpenJS.NodeJS.LTS`, or the MSI installer.
SETLOCAL
SET "HIPP0_BIN_DIR=%~dp0"
node "%HIPP0_BIN_DIR%hipp0.js" %*
EXIT /B %ERRORLEVEL%
