@echo off
setlocal
cd /d "%~dp0\..\.."

set ARTIFACT_DIR=load-tests\pvp-websocket\artifacts\latest
if not exist "%ARTIFACT_DIR%" mkdir "%ARTIFACT_DIR%"

node load-tests\pvp-websocket\prepare-load-window.cjs > "%ARTIFACT_DIR%\prepare-current.log" 2>&1
if errorlevel 1 exit /b 1

set PVP_WS_URL=ws://127.0.0.1:8787
set PVP_WS_TOKENS_FILE=load-tests/pvp-websocket/artifacts/latest/pvp_ws_tokens_load_window.json
set PVP_FIXED_CLIENT_SECRET=k6loadwindowclientsecretfixed12345
set PVP_WS_USER_AGENT=k6-ai-stress/1.0
set PVP_WS_ORIGIN=http://localhost:3000
set PVP_TEST_FORCE_BOT_MATCH=true
set PVP_SESSION_TIMEOUT_MS=60000

k6 run load-tests/pvp-websocket/pvp-websocket.js > "%ARTIFACT_DIR%\current-verify.log" 2>&1
set RUN_EXIT=%errorlevel%

if exist "%ARTIFACT_DIR%\ai-stress-summary.json" (
  copy /y "%ARTIFACT_DIR%\ai-stress-summary.json" "%ARTIFACT_DIR%\current-summary.json" >nul
)

exit /b %RUN_EXIT%
