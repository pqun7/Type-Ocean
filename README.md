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
- `npm run lint` - lint
- `npm run test` - jest watch
- `npm run test:ci` - jest CI run

## Troubleshooting
- Prisma errors about `DATABASE_URL`: verify `.env.local` is present and the URL is valid.
- Redis connection issues in Docker: set `REDIS_HOST=redis` (or `REDIS_URL=redis://redis:6379`).

