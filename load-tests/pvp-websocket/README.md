# PvP WebSocket Load Test

This folder is the canonical home for the PvP gateway websocket verification flow.

It consolidates:
- the k6 scenario
- token preparation
- Windows runner scripts
- latest retained artifacts

## Folder layout

- `pvp-websocket.js`: main k6 websocket scenario
- `prepare-load-window.cjs`: prepares fresh websocket tokens and captures the pre-run Postgres snapshot
- `run-verify-current.cmd`: quick current-environment verification
- `run-default-verify.cmd`: deterministic default-mode verification
- `run-ai-stress-verify.cmd`: deterministic ai-stress verification
- `run-strict.cmd`: stricter threshold run
- `artifacts/latest/`: only the latest retained outputs for this workflow

## Prerequisites

From the repo root:
- install dependencies with `npm install`
- build the gateway with `npm run pvp:gateway:build`
- have `k6` available on `PATH`
- have a reachable Postgres configured through the normal app/gateway env
- start the gateway separately before running verification

Typical local gateway settings:
- websocket URL: `ws://127.0.0.1:8787`
- origin: `http://localhost:3000`
- fixed client secret: `k6loadwindowclientsecretfixed12345`
- forced bot matching for local verification: `PVP_TEST_FORCE_BOT_MATCH=true`

## Start the gateway

PowerShell from the repo root:

```powershell
Set-Location "D:\Web projects\Type Space\type-space"
$env:PVP_TEST_FORCE_BOT_MATCH = "true"
$env:PVP_AI_QUEUE_TIMEOUT_MS = "1500"
npm run pvp:gateway:start
```

If you need a clean build first:

```powershell
Set-Location "D:\Web projects\Type Space\type-space"
npm run pvp:gateway:build
```

## Prepare tokens

The preparation script mints a fresh token pool and writes the current baseline files into `artifacts/latest`.

PowerShell:

```powershell
Set-Location "D:\Web projects\Type Space\type-space"
node load-tests/pvp-websocket/prepare-load-window.cjs
```

VS Code task:
- `pvp websocket prepare`

Expected outputs under `artifacts/latest`:
- `pvp_ws_tokens_load_window.json`
- `pg_stat_statements_before.json`
- preparation log files produced by the runner scripts

## Run verification

### Quick current verification

Uses the current environment with the canonical script path.

CMD:

```cmd
load-tests\pvp-websocket\run-verify-current.cmd
```

VS Code task:
- `pvp websocket verify current`

### Default verification

This is the preferred deterministic default-mode verification run.

CMD:

```cmd
load-tests\pvp-websocket\run-default-verify.cmd
```

VS Code task:
- `pvp websocket verify default`

Key outputs:
- `artifacts/latest/default-verify.log`
- `artifacts/latest/default-summary.json`

### AI-stress verification

This uses the ai-stress path with a reduced verification envelope so the run stays deterministic and rate-limit-safe.

CMD:

```cmd
load-tests\pvp-websocket\run-ai-stress-verify.cmd
```

VS Code task:
- `pvp websocket verify ai-stress`

Key outputs:
- `artifacts/latest/ai-stress-verify.log`
- `artifacts/latest/ai-stress-summary-copy.json`
- `artifacts/latest/ai-stress-status.txt`

### Strict run

This is the stricter threshold run for regression checking.

CMD:

```cmd
load-tests\pvp-websocket\run-strict.cmd
```

VS Code task:
- `pvp websocket strict`

## Manual k6 execution

PowerShell from the repo root:

```powershell
Set-Location "D:\Web projects\Type Space\type-space"
node load-tests/pvp-websocket/prepare-load-window.cjs
$env:PVP_WS_URL = "ws://127.0.0.1:8787"
$env:PVP_WS_TOKENS_FILE = "load-tests/pvp-websocket/artifacts/latest/pvp_ws_tokens_load_window.json"
$env:PVP_FIXED_CLIENT_SECRET = "k6loadwindowclientsecretfixed12345"
$env:PVP_WS_USER_AGENT = "k6-ai-stress/1.0"
$env:PVP_WS_ORIGIN = "http://localhost:3000"
$env:PVP_TEST_FORCE_BOT_MATCH = "true"
$env:PVP_SESSION_TIMEOUT_MS = "60000"
k6 run load-tests/pvp-websocket/pvp-websocket.js
```

## Important environment controls

Core connection env:
- `PVP_WS_URL`
- `PVP_WS_TOKENS_FILE`
- `PVP_FIXED_CLIENT_SECRET`
- `PVP_WS_USER_AGENT`
- `PVP_WS_ORIGIN`
- `PVP_SESSION_TIMEOUT_MS`

Deterministic typing and pacing controls already supported by the scenario:
- `PVP_TYPING_DELAY_SCALE`
- `PVP_TYPING_TYPO_RATE`
- `PVP_TYPING_PAUSE_RATE`
- `PVP_TYPING_MIN_DELAY_MS`
- `PVP_TYPING_FORCE_DELAY_MS`

AI-stress duration controls:
- `PVP_AI_STRESS_STAGE1_DURATION`
- `PVP_AI_STRESS_STAGE2_DURATION`
- `PVP_AI_STRESS_STAGE3_DURATION`

## Success criteria

Default verification targets:
- `pvp_ws_connect_errors = 0`
- `pvp_ws_results_rate >= 0.85`
- `pvp_ws_no_errors_received >= 0.95`

Strict verification target:
- no websocket protocol errors and thresholds fully green

Operational notes:
- gateway websocket general-message default rate limit is `40/s`
- gateway `INPUT_UPDATE` default rate limit is `25/s`
- repeated general rate-limit violations can produce websocket close `1013 Rate limit`

## Troubleshooting

If the run never gets a match:
- confirm the gateway is running on the expected port
- confirm `PVP_TEST_FORCE_BOT_MATCH=true` for local verification
- rerun `node load-tests/pvp-websocket/prepare-load-window.cjs`

If authentication fails:
- verify `PVP_FIXED_CLIENT_SECRET`
- verify the token file exists under `artifacts/latest`
- check gateway auth env such as `PVP_GATEWAY_JWT_SECRET`

If the socket closes with rate limiting:
- use the default verification or ai-stress verification scripts instead of an ad hoc higher-concurrency run
- lower typing speed by increasing the effective delay controls

If you need logs:
- read the latest retained files under `artifacts/latest`
- the older scattered websocket logs under `logs/latest` are intentionally being retired in favor of this folder

## Related docs

- root project overview: `README.md`
- gateway service details: `services/pvp-gateway/README.md`
- query-performance notes: `docs/pvp-prepared-statements-measurement.md`
