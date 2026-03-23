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
- `PVP_TRUST_PROXY_TLS` (`1`/`0`, default: `0`). Set to `1` when a trusted proxy / platform edge terminates TLS and forwards `x-forwarded-proto=https`.
- `PVP_TLS_KEY_PATH` / `PVP_TLS_CERT_PATH` (required in production only when the gateway terminates TLS directly)
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
- Use the consolidated workspace in [load-tests/pvp-websocket/README.md](../../load-tests/pvp-websocket/README.md).
- Primary entrypoints from the repo root:
	- `node load-tests/pvp-websocket/prepare-load-window.cjs`
	- `k6 run load-tests/pvp-websocket/pvp-websocket.js`
	- `load-tests\pvp-websocket\run-verify-current.cmd`
	- `load-tests\pvp-websocket\run-default-verify.cmd`
	- `load-tests\pvp-websocket\run-ai-stress-verify.cmd`
	- `load-tests\pvp-websocket\run-strict.cmd`
- Latest websocket test artifacts now live under [load-tests/pvp-websocket/artifacts/latest](../../load-tests/pvp-websocket/artifacts/latest).

## Transport / edge protection
- Production deployments should expose the gateway over **WSS only**.
- Use `PVP_TRUST_PROXY_TLS=1` when deploying behind a trusted reverse proxy or platform edge that terminates TLS for you.
- Use `PVP_TLS_KEY_PATH` and `PVP_TLS_CERT_PATH` only when the gateway itself terminates TLS directly.
- A WAF / CDN is still recommended at the infrastructure layer for volumetric DDoS protection.
- Keep `PVP_ALLOWED_ORIGINS` aligned with the frontend origin(s) that fetch `/api/pvp/ws-token`.

## Vercel production topology
- Deploy the Next.js app to Vercel.
- Deploy this gateway as a separate long-lived service (for example Fly.io, Railway, Render, or any container host) using this directory's `Dockerfile`.
- Set `NEXT_PUBLIC_PVP_WS_URL` in Vercel to the public `wss://` URL of the gateway.
- Set `PVP_ALLOWED_ORIGINS` in the gateway to your Vercel origin(s), for example `https://your-app.vercel.app,https://example.com`.
- Share the same `PVP_GATEWAY_JWT_SECRET` value between Vercel and the gateway service.
- If your platform already terminates TLS, set `PVP_TRUST_PROXY_TLS=1` and leave `PVP_TLS_KEY_PATH` / `PVP_TLS_CERT_PATH` empty.

## Fly.io deployment
- A ready-to-edit Fly config now lives at [fly.toml](../../fly.toml).
- The Fly config deploys this gateway only, not the Next.js app.
- Before first deploy, change `app = "type-space-pvp-gateway"` in [fly.toml](../../fly.toml) to a globally unique Fly app name.
- Keep `PVP_TRUST_PROXY_TLS=1` on Fly because Fly terminates TLS at the edge and forwards secure requests to the app.

Deploy steps:
- Install `flyctl` and sign in.
- Create the app once: `fly apps create your-pvp-gateway-name`
- Set required secrets:
	- `fly secrets set DATABASE_URL=...`
	- `fly secrets set PVP_GATEWAY_JWT_SECRET=...`
	- `fly secrets set PVP_ALLOWED_ORIGINS=https://your-project.vercel.app,https://your-domain.com`
- Optional Redis / scale-out secrets when used:
	- `fly secrets set PVP_USE_REDIS=1`
	- `fly secrets set PVP_REDIS_URL=redis://...`
- Deploy from the repo root: `fly deploy`

Then configure Vercel:
- `NEXT_PUBLIC_PVP_WS_URL=wss://your-pvp-gateway-name.fly.dev`
- `PVP_GATEWAY_JWT_SECRET=...` with the exact same value used on Fly

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
- The websocket k6 script expects `PVP_WS_URL` and a token pool prepared by [load-tests/pvp-websocket/prepare-load-window.cjs](../../load-tests/pvp-websocket/prepare-load-window.cjs).
- Each virtual user opens a websocket, authenticates with `HELLO`, joins queue, joins the match, streams incremental `INPUT_UPDATE` messages, and finishes the race.
- This is intended for gateway performance validation, not for minting tokens or browser-auth simulation.
- The full setup, env matrix, artifact map, and validation commands are documented in [load-tests/pvp-websocket/README.md](../../load-tests/pvp-websocket/README.md).
