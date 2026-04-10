# Env Management & Secret Rotation Strategy

This document outlines the strategy for managing environment variables and rotating secrets in Type Ocean.

## 1. Environment File Structure
The project uses a structured multi-file system:
- `.env`: Default values (non-sensitive).
- `.env.local`: Local development overrides (gitignored, contains real secrets).
- `.env.example`: Template for setup, includes documentation.
- `.env.production`: Production-specific non-sensitive defaults.

## 2. Runtime Validation
We use `@t3-oss/env-nextjs` and `zod` in `src/env.mjs` to ensure:
- Variables are present before the app starts.
- Types match expectations (e.g., URLs, Booleans).
- Minimum lengths for secrets.

## 3. Secret Rotation Strategy
To mitigate risk, rotate secrets periodically or upon suspected leaks. 
**Tools Recommended**: Doppler (for automated sync) or AWS/Vault/Vercel CLI.

### Immediate Rotation Steps (If Leaked)
1. **GitHub/Google OAuth**: Rotate in the provider's developer console. Update `.env.local` or Doppler.
2. **DATABASE_URL**: Rotate Postgres user credentials via Neon dashboard.
3. **PVP_GATEWAY_JWT_SECRET**: Update this to invalidate all current player sessions instantly.
4. **AUTH_SECRET**: Updating this will log out all current users.

### Automation
For production, use one of the following:
- **Vercel CLI/Terraform**: Automate environment updates in CI.
- **Doppler**: Use their CLI to inject environment variables at runtime (`doppler run -- npm run start`).

## 4. Multi-Service Isolation
The `pvp-gateway` and `Next.js` frontend share the same database and Redis but use different auth mechanisms:
- `Next.js` uses `AUTH_SECRET` for UI sessions.
- `pvp-gateway` uses `PVP_GATEWAY_JWT_SECRET` for stateless WebSocket authorization.
- **Critical Risk**: Never use the same secret for both to ensure that a breach in one service does not compromise the entire system.
