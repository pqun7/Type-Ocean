# PvP Gateway (WebSocket)

This service provides realtime PvP for:
- 1v1 Ranked (skill-based matchmaking)
- Private Rooms (2–6 players via invite code)

It is designed to run **separately from Next.js** (e.g. on Fly.io), while the Next.js app (Vercel) issues short-lived WS tokens.

## Env
- `PORT` (default: 8787)
- `DATABASE_URL` (same Postgres as the app)
- `PVP_GATEWAY_JWT_SECRET` (shared with Next API `/api/pvp/ws-token`)

Security / limits:
- `PVP_ALLOWED_ORIGINS` (comma-separated). **Required in production**.
- `PVP_TLS_KEY_PATH` / `PVP_TLS_CERT_PATH` (required in production for direct TLS termination)
- `PVP_TLS_CA_PATH` (optional chain / CA bundle)
- `PVP_WS_TOKEN_TTL_SECONDS` (default: 900)
- `PVP_WS_TOKEN_REFRESH_WINDOW_SECONDS` (default: 120)
- `PVP_WS_MAX_PAYLOAD_BYTES` (default: 65536)
- `PVP_WS_MAX_MSG_PER_SEC` / `PVP_WS_MAX_MSG_BURST` (general message rate limit; defaults: 40 / 80)
- `PVP_WS_MAX_INPUT_MSG_PER_SEC` / `PVP_WS_MAX_INPUT_MSG_BURST` (INPUT_UPDATE rate limit; defaults: 25 / 50)
- `PVP_WS_MAX_CONNECTIONS_PER_IP` (default: 5)
- `PVP_WS_CONNECTION_ATTEMPTS_PER_MIN` / `PVP_WS_CONNECTION_ATTEMPTS_BURST` (defaults: 20 / 10)
- `PVP_WS_TICK_MS` (batched outbound flush tick, default: 60)
- `PVP_MATCH_SNAPSHOT_INTERVAL_MS` (periodic anti-desync snapshot interval, default: 2000)
- `PVP_METRIC_SNAPSHOT_INTERVAL_MS` (gauge refresh interval, default: 5000)
- `PVP_ROOM_ACTION_COOLDOWN_MS` (default: 2000)
- `PVP_WS_CONNECTION_SPIKE_ALERT_THRESHOLD` (default: 30)

Multi-instance (optional):
- `PVP_USE_REDIS` (`1`/`0`, default: `0`)
- `PVP_REDIS_URL` (or `REDIS_URL`)
- `PVP_ONLINE_TTL_SEC` (presence TTL, default: 90)
- `PVP_QUEUE_RATING_RANGE` (matchmaking rating window, default: 200)

## Scripts (from repo root)
- `npm run pvp:gateway:build`
- `npm run pvp:gateway:start`

Load testing:
- `k6 run src/load-tests/pvp-websocket.js`

## Transport / edge protection
- Production deployments should expose the gateway over **WSS only**.
- This service now supports direct TLS termination via `PVP_TLS_KEY_PATH` and `PVP_TLS_CERT_PATH`.
- A WAF / CDN is still recommended at the infrastructure layer for volumetric DDoS protection.
- Keep `PVP_ALLOWED_ORIGINS` aligned with the frontend origin(s) that fetch `/api/pvp/ws-token`.

## Health / telemetry
- `GET /healthz` returns a simple readiness response.
- `GET /metrics` returns Prometheus-style counters, gauges, and histograms.
- Current telemetry includes:
	- websocket inbound / outbound message counts
	- batch flush size histograms
	- message size histograms for immediate sends
	- active connection / queue depth / active match gauges
	- disconnect-forfeit and idempotency counters
	- periodic snapshot counters

## Protocol (high level)
Client sends:
- `HELLO { token, clientSecret }`
- `AUTH_REFRESH { token, clientSecret }`
- `QUEUE_JOIN {}` + optional top-level `requestId`
- `ROOM_JOIN { code }` + optional top-level `requestId`
- `READY {}` + optional top-level `requestId`
- `MATCH_JOIN { matchId }` + optional top-level `requestId`
- `INPUT_UPDATE { matchId, input, seq, clientTs }` + optional top-level `requestId`
- `FINISH { matchId, clientTs }` + optional top-level `requestId`

Server sends:
- `HELLO_OK { user }`
- `AUTH_REFRESH_OK { expiresAt }`
- `QUEUE_STATUS { status }`
- `ROOM_STATE { room }`
- `MATCH_FOUND { matchId, textSnapshot, serverStartAt, players }`
- `MATCH_STATE { match }`
- `MATCH_ENDED { matchId, reason, message, finalResultsPending? }`
- `PROGRESS { matchId, userId, caretIndex, wpm, accuracy, errors }`
- `RESULTS { matchId, placements, ratingChanges }`
- `ERROR { message }`

## Phase 2 reliability note
- Current in-memory match state is process-local. Distributed authoritative state is planned for a future phase.
- Phase 2 introduces explicit lifecycle helpers, event hooks, and disconnect-forfeit handling groundwork, but it does not yet make live match state horizontally authoritative across gateway instances.

## Phase 3 load test notes
- The websocket k6 script expects `PVP_WS_URL` and a pool of pre-issued auth tokens via `PVP_WS_TOKENS_JSON` (preferred) or `PVP_WS_TOKENS`.
- Each virtual user opens a websocket, authenticates with `HELLO`, joins queue, joins the match, streams incremental `INPUT_UPDATE` messages, and finishes the race.
- This is intended for gateway performance validation, not for minting tokens or browser-auth simulation.
