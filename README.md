# Type Space

Next.js (App Router) typing app with Drizzle ORM + Postgres, NextAuth, and optional Redis-backed rate limiting.

## Prerequisites
- Node.js 18+ (recommended: 20)
- PostgreSQL (local) OR Docker
- Redis (optional but recommended for rate limiting / caching)

## Environment variables
Create `.env.local` (recommended) using `.env.example`.

Minimum required:
- `AUTH_SECRET` (32+ chars)
- `DATABASE_URL`

Optional (OAuth):
- `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`

Optional (Redis):
- `REDIS_URL` OR `REDIS_HOST` + `REDIS_PORT` (+ `REDIS_PASSWORD` if needed)

Optional (PvP gateway):
- `NEXT_PUBLIC_PVP_WS_URL` for the PvP websocket endpoint.
	- Local gateway dev (`npm run pvp:gateway:dev`): use `ws://localhost:8787`.
	- Production/public gateway: use `wss://your-gateway-host`.

Where to get Redis values:
- Local (Docker/installed Redis): use `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379`, and leave `REDIS_PASSWORD` empty.
- Docker Compose in this repo: use `REDIS_HOST=redis`, `REDIS_PORT=6379` (the service name is `redis`).
- Hosted (Upstash / Redis Cloud): copy the provided connection string into `REDIS_URL`.
	- If the URL starts with `rediss://`, TLS is enabled automatically.
	- If you must use host/port with TLS, set `REDIS_TLS=true`.

Optional (Avatar uploads via Vercel Blob):
- `BLOB_READ_WRITE_TOKEN`

## Local setup (no Docker)
```bash
npm install
npm run drizzle:generate
npm run drizzle:migrate
npm run dev
```

If you want Redis locally:
- run `npm run redis:start` (tries WSL/bash first, then Docker fallback)

## Docker (Postgres + app)
```bash
docker compose up --build
```

Notes:
- The compose file exposes Postgres on `5432` and the app on `3000`.
- For first-time DB init inside Docker, you may still need migrations:
	- either run `npm run drizzle:migrate` locally pointing at the compose Postgres
	- or exec into the app container and run Drizzle migration commands

## Scripts
- `npm run dev` - Next.js dev server
- `npm run build` - production build
- `npm run start` - start production server
- `npm run pvp:gateway:build` - build the PvP WebSocket gateway
- `npm run pvp:gateway:start` - start the built PvP WebSocket gateway
- `npm run pvp:gateway:dev` - run the PvP WebSocket gateway in development mode

Gateway startup note:
- If you see `EADDRINUSE` for port `8787`, another process is already bound to that port.
- PowerShell override example: `$env:PORT = "8788"; npm run pvp:gateway:start`
- Cmd override example: `set PORT=8788 && npm run pvp:gateway:start`

## Load Testing
Use this flow to run a reproducible PvP websocket load test with k6.

1. Prepare env values in `.env.local` (or inline in your task shell):
- `PVP_WS_URL=ws://127.0.0.1:8787`
- `PVP_FIXED_CLIENT_SECRET=<same secret used for token minting>`
- `PVP_WS_USER_AGENT=k6-ai-stress/1.0`
- `PVP_WS_ORIGIN=http://localhost:3000`
- `PVP_WS_TOKENS_FILE=logs/pvp_ws_tokens_load_window.json` (preferred)
- Optional fallback: `PVP_WS_TOKENS` (comma-separated or JSON array string)

2. Generate fresh websocket tokens with the same `PVP_FIXED_CLIENT_SECRET` used in k6.

3. Start gateway in DEV mode:
- `npm run pvp:gateway:start`
- Optional deterministic matchmaking for load windows: set `PVP_TEST_FORCE_BOT_MATCH=true`.

4. Run k6:
- Use VS Code task `k6 verify websocket fixed` or `k6 50 top3 capture`.

### Commands tested on Windows (copy/paste)

PowerShell (recommended):

```powershell
Set-Location "D:\Web projects\Type Space\type-space"

# 1) Start gateway in a dedicated terminal
$env:PVP_TEST_FORCE_BOT_MATCH = "true"
$env:PVP_AI_QUEUE_TIMEOUT_MS = "1500"
npm run pvp:gateway:start
```

```powershell
Set-Location "D:\Web projects\Type Space\type-space"

# 2) Prepare tokens + run k6 with working local settings
node logs/prepare_load_window.cjs
$env:PVP_WS_URL = "ws://127.0.0.1:8787"
$env:PVP_WS_TOKENS_FILE = "logs/pvp_ws_tokens_load_window.json"
$env:PVP_FIXED_CLIENT_SECRET = "k6loadwindowclientsecretfixed12345"
$env:PVP_WS_USER_AGENT = "k6-ai-stress/1.0"
$env:PVP_WS_ORIGIN = "http://localhost:3000"
$env:PVP_TEST_FORCE_BOT_MATCH = "true"
$env:PVP_SESSION_TIMEOUT_MS = "60000"
k6 run src/load-tests/pvp-websocket.js
```

CMD one-liner:

```cmd
cmd /d /c "cd /d D:\Web projects\Type Space\type-space&&node logs\prepare_load_window.cjs&&set PVP_WS_URL=ws://127.0.0.1:8787&&set PVP_WS_TOKENS_FILE=logs/pvp_ws_tokens_load_window.json&&set PVP_FIXED_CLIENT_SECRET=k6loadwindowclientsecretfixed12345&&set PVP_WS_USER_AGENT=k6-ai-stress/1.0&&set PVP_WS_ORIGIN=http://localhost:3000&&set PVP_TEST_FORCE_BOT_MATCH=true&&set PVP_SESSION_TIMEOUT_MS=60000&&k6 run src/load-tests/pvp-websocket.js"
```

Predefined script (same flow):

```cmd
logs\run_verify_current.cmd
```

5. Read success metrics from k6 summary:
- `pvp_ws_connect_errors` should be `0` (or effectively zero).
- `pvp_ws_results_rate` target is `>= 0.85`.
- `pvp_ws_no_errors_received` should be high (`>= 0.95`, or `1` in strict mode).

6. Investigate protocol failures quickly:
- k6 now logs websocket `ERROR` payload `code`, `message`, `retryable`, `phase`, `requestId`.
- Gateway HELLO now emits specific auth codes (`PVP_TOKEN_EXPIRED`, `PVP_INVALID_TOKEN`, `PVP_BAD_SECRET`, `PVP_AUTH_FAILED`).

7. Test bypass mode (local/dev only):
- `PVP_TEST_BYPASS_AUTH=true` allows HELLO/auth-state bypass only outside production.
- The bypass is guarded by `NODE_ENV !== production`; do not use bypass in production.

8. Logs output:
- Latest run artifacts are written under `logs/latest/` by load-testing tasks.

- `npm run lint` - lint
- `npm run test` - jest watch
- `npm run test:ci` - jest CI run
- `npm run admin:grant -- --email you@example.com` - grant admin locally through Drizzle-backed scripts

## Production deployment
- Deploy the Next.js app to Vercel.
- Deploy the PvP gateway as a separate service; Vercel should not be used for the long-lived WebSocket gateway in this repo.
- Set `NEXT_PUBLIC_PVP_WS_URL` in Vercel to your gateway's public `wss://` URL.
- Set the same `PVP_GATEWAY_JWT_SECRET` value in both Vercel and the gateway service.
- Set `PVP_ALLOWED_ORIGINS` in the gateway to your Vercel origin(s), such as `https://your-project.vercel.app,https://your-domain.com`.
- If the gateway host terminates TLS at the edge, set `PVP_TRUST_PROXY_TLS=1` in the gateway and leave `PVP_TLS_KEY_PATH` / `PVP_TLS_CERT_PATH` empty.
- A starter Fly.io gateway config is available at [fly.toml](fly.toml).
- See [services/pvp-gateway/README.md](services/pvp-gateway/README.md) for gateway runtime details.

## Get Started: Vercel Speed Insights
To start collecting performance metrics, follow these steps.

### 1. Install the package
Install Speed Insights in your existing project:

```bash
npm i @vercel/speed-insights
```

### 2. Add the Next.js component
Import and render `SpeedInsights` in your app layout (or main app entry):

```tsx
import { SpeedInsights } from "@vercel/speed-insights/next";

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>
				{children}
				<SpeedInsights />
			</body>
		</html>
	);
}
```

For full examples and reference, see the official docs:
- https://vercel.com/docs/speed-insights

### 3. Deploy and visit your site
Deploy your changes and visit your deployment to collect your first data points.

If you do not see data after about 30 seconds, check content blockers and navigate between pages on your site.

Gateway notes:
- Detailed gateway setup and runtime options are documented in [services/pvp-gateway/README.md](services/pvp-gateway/README.md).

## Auth notes
- Main app auth currently uses Auth.js JWT sessions.
- Middleware-protected routes under `/api/protected/*` use explicit `jwt` cookie verification plus DB validation.
- Deleted users and banned users must never be trusted from JWT payload alone.
- Short auth conventions and invariants are documented in [docs/auth-conventions.md](docs/auth-conventions.md).
- Admin access is controlled by `User.role === "admin"` in the database. Prefer local one-off role changes over exposing a public admin-promotion endpoint.

## Troubleshooting
- Database connection errors about `DATABASE_URL`: verify `.env.local` is present and the URL is valid.
- Redis connection issues in Docker: set `REDIS_HOST=redis` (or `REDIS_URL=redis://redis:6379`).



$env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','User') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','Machine')
.\scripts\local-prod.ps1