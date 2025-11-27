# API Issue Log

> Track API-related problems across backend and frontend with consistent fields and reproducible steps.

| ID | Endpoint | Request Type | Observed Behavior | Expected Behavior | HTTP Status / Error Code | Severity | Status | Steps to Reproduce | Notes |
|---|---|---|---|---|---|---|---|---|---|
| API-001 | /api/user | GET | e.g., 401 returned despite active session | Returns user profile when authenticated | 401 | High | Open | 1) Login 2) GET /api/user with cookies 3) Observe | Link logs, handler path, commits |
| API-002 | /api/session-stats/v1 | POST | e.g., valid payload rejected for timeSpent > 7200 | Accept up to configured max duration | 400 | Medium | Investigating | 1) POST payload X 2) Capture response | Related helper: `src/helper/session-stats.ts` |

## Severity and Status
- Severity: Critical / High / Medium / Low
- Status: Open / Investigating / In Progress / Blocked / Fixed / Verified

## Entry Notes
- Include precise headers (e.g., `Cookie`, `Authorization`, `x-user-id`, `x-session-id`), payloads, and environment (local/dev/prod).
- Link to handler and caller files; reference logs and monitoring events.
- Prefer deterministic reproduction with minimal required steps.

## Reference Pointers (code and logs)
- Handlers
  - User API: `src/app/api/user/route.ts`
  - Session Stats API: `src/app/api/session-stats/v1/route.ts`
  - Daily Challenge API (from load tests): GET/PATCH `/api/challenge/v1/daily` (caller visible in `src/load-tests/challenge-api.js`)
- Backing logic and validation
  - Session stats helper: `src/helper/session-stats.ts` (`validateSessionData`, `sanitizeSessionData`, Redis ops)
  - Rate limiter: `src/lib/rate-limiter.ts`
  - Middleware: `middleware.ts` (global constraints and headers)
- Logging and monitoring
  - Server logging: `src/log/ServerLogger.ts`, `src/log/loggingUtils.ts`
  - Client logging: `src/log/clientLogger.ts` (auth, perf, challenge, session)
  - Monitoring: `src/monitoring/productionHealthMonitor.ts`, `src/monitoring/monitoringSystem.ts`, `src/monitoring/circuitBreaker.ts`
- Load tests
  - `src/load-tests/challenge-api.js` (GET/PATCH `/api/challenge/v1/daily`)

## Initial Candidate Entries (fill as you validate)
- /api/user GET: 401/403 under certain session states or missing cookies; confirm `auth()` context and rate-limit headers.
- /api/user PATCH: 409 on username/email conflicts; verify validation messages and case-insensitive checks.
- /api/session-stats/v1 POST: strict bounds for `wpm`, `accuracy`, `timeSpent` cause 400; ensure client constraints match server.
- /api/session-stats/v1 GET: pagination/limit behavior with `includeHistory`; confirm response shape and empty arrays on errors.
- Rate-limiting: 429 for burst calls on `/api/user:*` and `/api/session-stats/v1`; confirm header propagation.
- Idempotency: duplicate POST with `x-session-id` returns cached stats; verify consistency and TTL interactions.
