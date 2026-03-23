@echo off
setlocal
cd /d "%~dp0\..\.."

set ARTIFACT_DIR=load-tests\pvp-websocket\artifacts\latest
if not exist "%ARTIFACT_DIR%" mkdir "%ARTIFACT_DIR%"

echo Preparing fresh tokens and pg baseline...
node load-tests\pvp-websocket\prepare-load-window.cjs > "%ARTIFACT_DIR%\prepare-strict.log" 2>&1
if errorlevel 1 (
  echo Failed to prepare load window artifacts. See %ARTIFACT_DIR%\prepare-strict.log
  exit /b 1
)

set PVP_WS_URL=ws://127.0.0.1:8787
set PVP_WS_TOKENS_FILE=load-tests/pvp-websocket/artifacts/latest/pvp_ws_tokens_load_window.json
set PVP_FIXED_CLIENT_SECRET=k6loadwindowclientsecretfixed12345
set PVP_WS_USER_AGENT=k6-ai-stress/1.0
set PVP_WS_ORIGIN=http://localhost:3000
set PVP_STRICT_THRESHOLDS=true
set PVP_DEFAULT_STAGE1_DURATION=15s
set PVP_DEFAULT_STAGE2_DURATION=55s
set PVP_DEFAULT_STAGE3_DURATION=20s

echo Running strict k6; output -> %ARTIFACT_DIR%\strict.log
k6 run load-tests/pvp-websocket/pvp-websocket.js > "%ARTIFACT_DIR%\strict.log" 2>&1
set K6_EXIT=%ERRORLEVEL%

(
  echo exit_code=%K6_EXIT%
) > "%ARTIFACT_DIR%\strict.env"

if exist "%ARTIFACT_DIR%\ai-stress-summary.json" (
  copy /y "%ARTIFACT_DIR%\ai-stress-summary.json" "%ARTIFACT_DIR%\strict-summary.json" >nul
)

exit /b %K6_EXIT%
