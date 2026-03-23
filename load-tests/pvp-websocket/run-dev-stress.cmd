@echo off
setlocal
cd /d "%~dp0\..\.."

set ARTIFACT_DIR=load-tests\pvp-websocket\artifacts\latest
if not exist "%ARTIFACT_DIR%" mkdir "%ARTIFACT_DIR%"

echo Preparing tokens...
node load-tests\pvp-websocket\prepare-load-window.cjs > "%ARTIFACT_DIR%\dev-stress-prepare.log" 2>&1
if errorlevel 1 (
  echo ERROR: Token preparation failed. See %ARTIFACT_DIR%\dev-stress-prepare.log
  exit /b 1
)

echo Running dev stress test (14 VUs, ai-stress mode, rate-limit bypassed on gateway)...

set PVP_WS_MODE=ai-stress
set PVP_WS_URL=ws://127.0.0.1:8787
set PVP_WS_TOKENS_FILE=load-tests/pvp-websocket/artifacts/latest/pvp_ws_tokens_load_window.json
set PVP_FIXED_CLIENT_SECRET=k6loadwindowclientsecretfixed12345
set PVP_WS_USER_AGENT=k6-ai-stress/1.0
set PVP_WS_ORIGIN=http://localhost:3000
set PVP_TEST_FORCE_BOT_MATCH=true
set PVP_STRICT_THRESHOLDS=false
rem Target 14 VUs (within the 12-15 target) — all matched to bots
set PVP_AI_STRESS_TARGET_VUS=14
set PVP_AI_STRESS_PEAK_VUS=14
set PVP_AI_STRESS_STAGE1_DURATION=10s
set PVP_AI_STRESS_STAGE2_DURATION=30s
set PVP_AI_STRESS_STAGE3_DURATION=10s
set PVP_SESSION_TIMEOUT_MS=90000
set PVP_TYPING_DELAY_SCALE=0.10
set PVP_TYPING_MIN_DELAY_MS=40
set PVP_TYPING_FORCE_DELAY_MS=40
set PVP_TYPING_TYPO_RATE=0
set PVP_TYPING_PAUSE_RATE=0

k6 run load-tests/pvp-websocket/pvp-websocket.js > "%ARTIFACT_DIR%\dev-stress-run.log" 2>&1
set RUN_EXIT=%errorlevel%

echo Exit code: %RUN_EXIT%
type "%ARTIFACT_DIR%\dev-stress-run.log"

exit /b %RUN_EXIT%
