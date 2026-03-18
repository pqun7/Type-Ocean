@echo off
setlocal
cd /d "%~dp0.."

node logs\prepare_load_window.cjs
if errorlevel 1 exit /b 1

set PVP_WS_URL=ws://127.0.0.1:8787
set PVP_WS_TOKENS_FILE=logs/pvp_ws_tokens_load_window.json
set PVP_FIXED_CLIENT_SECRET=k6loadwindowclientsecretfixed12345
set PVP_WS_USER_AGENT=k6-ai-stress/1.0
set PVP_WS_ORIGIN=http://localhost:3000
set PVP_TEST_FORCE_BOT_MATCH=true
set PVP_SESSION_TIMEOUT_MS=60000

k6 run src/load-tests/pvp-websocket.js > logs\k6_verify_current.txt 2>&1
exit /b %errorlevel%
