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
- `PVP_WS_MAX_PAYLOAD_BYTES` (default: 65536)
- `PVP_WS_MAX_MSG_PER_SEC` / `PVP_WS_MAX_MSG_BURST` (general message rate limit; defaults: 40 / 80)
- `PVP_WS_MAX_INPUT_MSG_PER_SEC` / `PVP_WS_MAX_INPUT_MSG_BURST` (INPUT_UPDATE rate limit; defaults: 25 / 50)

Multi-instance (optional):
- `PVP_USE_REDIS` (`1`/`0`, default: `0`)
- `PVP_REDIS_URL` (or `REDIS_URL`)
- `PVP_ONLINE_TTL_SEC` (presence TTL, default: 90)
- `PVP_QUEUE_RATING_RANGE` (matchmaking rating window, default: 200)

## Scripts (from repo root)
- `npm run pvp:gateway:build`
- `npm run pvp:gateway:start`

## Protocol (high level)
Client sends:
- `HELLO { token }`
- `QUEUE_JOIN {}`
- `ROOM_JOIN { code }`
- `READY {}`
- `MATCH_JOIN { matchId }`
- `INPUT_UPDATE { matchId, input, seq, clientTs }`
- `FINISH { matchId, clientTs }`

Server sends:
- `HELLO_OK { user }`
- `QUEUE_STATUS { status }`
- `ROOM_STATE { room }`
- `MATCH_FOUND { matchId, textSnapshot, serverStartAt, players }`
- `MATCH_STATE { match }`
- `PROGRESS { matchId, userId, caretIndex, wpm, accuracy, errors }`
- `RESULTS { matchId, placements, ratingChanges }`
- `ERROR { message }`
