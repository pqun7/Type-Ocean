@echo off
setlocal

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set TS=%%I
set LOG_FILE=logs\k6_strict_%TS%.txt

set PVP_WS_URL=ws://127.0.0.1:8787
set PVP_WS_TOKENS_FILE=D:/Web projects/Type Space/type-space/logs/pvp_ws_tokens_load_window.json
set PVP_FIXED_CLIENT_SECRET=k6loadwindowclientsecretfixed12345
set PVP_WS_USER_AGENT=k6-ai-stress/1.0
set PVP_WS_ORIGIN=http://localhost:3000
set PVP_STRICT_THRESHOLDS=true
set PVP_DEFAULT_STAGE1_DURATION=15s
set PVP_DEFAULT_STAGE2_DURATION=55s
set PVP_DEFAULT_STAGE3_DURATION=20s

echo Preparing fresh tokens and pg baseline...
node logs\prepare_load_window.cjs > logs\prepare_load_window_output.json 2>&1
if errorlevel 1 (
	echo Failed to prepare load window artifacts. See logs\prepare_load_window_output.json
	exit /b 1
)

echo Running strict k6; output -> %LOG_FILE%
k6 run src/load-tests/pvp-websocket.js > "%LOG_FILE%" 2>&1
set K6_EXIT=%ERRORLEVEL%

copy /Y "%LOG_FILE%" "logs\k6_strict_latest.txt" >nul
(
	echo timestamp=%TS%
	echo file=%LOG_FILE%
	echo exit_code=%K6_EXIT%
) > "logs\k6_strict_latest.env"

if /I not "%PVP_SKIP_LOG_CLEANUP%"=="true" (
	echo Running log cleanup - keep last 3 strict runs...
	node logs\cleanup-artifacts.cjs --keep=3 --quiet
)

echo Latest strict log: %LOG_FILE%
exit /b %K6_EXIT%
