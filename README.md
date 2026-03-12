# Type Space

Next.js (App Router) typing app with Prisma + Postgres, NextAuth, and optional Redis-backed rate limiting.

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
npm run prisma:generate
npm run prisma:migrate
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
	- either run `npm run prisma:migrate` locally pointing at the compose Postgres
	- or exec into the app container and run Prisma commands

## Scripts
- `npm run dev` - Next.js dev server
- `npm run build` - production build
- `npm run start` - start production server
- `npm run pvp:gateway:build` - build the PvP WebSocket gateway
- `npm run pvp:gateway:start` - start the built PvP WebSocket gateway
- `npm run pvp:gateway:dev` - run the PvP WebSocket gateway in development mode
- `npm run lint` - lint
- `npm run test` - jest watch
- `npm run test:ci` - jest CI run
- `npm run admin:grant -- --email you@example.com` - grant admin locally through Prisma

Gateway notes:
- Detailed gateway setup and runtime options are documented in [services/pvp-gateway/README.md](services/pvp-gateway/README.md).

## Auth notes
- Main app auth currently uses Auth.js JWT sessions.
- Middleware-protected routes under `/api/protected/*` use explicit `jwt` cookie verification plus DB validation.
- Deleted users and banned users must never be trusted from JWT payload alone.
- Short auth conventions and invariants are documented in [docs/auth-conventions.md](docs/auth-conventions.md).
- Admin access is controlled by `User.role === "admin"` in the database. Prefer local one-off role changes over exposing a public admin-promotion endpoint.

## Troubleshooting
- Prisma errors about `DATABASE_URL`: verify `.env.local` is present and the URL is valid.
- Redis connection issues in Docker: set `REDIS_HOST=redis` (or `REDIS_URL=redis://redis:6379`).

