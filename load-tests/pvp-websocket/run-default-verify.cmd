@echo off
setlocal
cd /d "%~dp0\..\.."

set ARTIFACT_DIR=load-tests\pvp-websocket\artifacts\latest
if not exist "%ARTIFACT_DIR%" mkdir "%ARTIFACT_DIR%"

node load-tests\pvp-websocket\prepare-load-window.cjs > "%ARTIFACT_DIR%\prepare-default.log" 2>&1
if errorlevel 1 exit /b %errorlevel%

set PVP_WS_URL=ws://127.0.0.1:8787
set PVP_WS_TOKENS_FILE=load-tests/pvp-websocket/artifacts/latest/pvp_ws_tokens_load_window.json
set PVP_FIXED_CLIENT_SECRET=k6loadwindowclientsecretfixed12345
set PVP_WS_USER_AGENT=k6-ai-stress/1.0
set PVP_WS_ORIGIN=http://localhost:3000
set PVP_TEST_FORCE_BOT_MATCH=true
set PVP_DEFAULT_STAGE1_VUS=1
set PVP_DEFAULT_STAGE2_VUS=1
set PVP_DEFAULT_STAGE1_DURATION=1s
set PVP_DEFAULT_STAGE2_DURATION=80s
set PVP_DEFAULT_STAGE3_DURATION=2s
set PVP_SESSION_TIMEOUT_MS=110000
set PVP_TYPING_DELAY_SCALE=0.10
set PVP_TYPING_MIN_DELAY_MS=45
set PVP_TYPING_FORCE_DELAY_MS=40
set PVP_TYPING_TYPO_RATE=0
set PVP_TYPING_PAUSE_RATE=0

k6 run load-tests/pvp-websocket/pvp-websocket.js > "%ARTIFACT_DIR%\default-verify.log" 2>&1
set RUN_EXIT=%errorlevel%

if exist "%ARTIFACT_DIR%\ai-stress-summary.json" (
  copy /y "%ARTIFACT_DIR%\ai-stress-summary.json" "%ARTIFACT_DIR%\default-summary.json" >nul
)

exit /b %RUN_EXIT%
