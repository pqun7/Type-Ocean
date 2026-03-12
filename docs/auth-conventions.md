# Auth Conventions

## Current model
- Browser auth currently uses Auth.js JWT sessions for the main application.
- Middleware-protected API routes under `/api/protected/*` use the `jwt` httpOnly cookie and explicit JWT verification in [middleware.ts](../middleware.ts).
- A JWT is never trusted by signature alone. Every authenticated request must validate that the backing `User` still exists in the database.

## Invariants
- If a token points to a user that no longer exists, the request is treated as unauthenticated.
- Stale auth cookies must be cleared when a missing user is detected.
- Protected request context is forwarded only through internal headers, never from client-controlled headers.
- Use [src/features/auth/server/protected-request-user.ts](../src/features/auth/server/protected-request-user.ts) to read or build forwarded protected-route user headers.
- Use [src/features/auth/server/player-profile.ts](../src/features/auth/server/player-profile.ts) for PlayerProfile create-or-update flows outside explicit user-creation transactions.
- `User.banned=true` is a hard stop for middleware-protected JWT routes. The session should be rejected and cookies cleared.
- Negative caching for deleted users is allowed only for short TTLs and only for `user not found` states.

## Negative cache
- Middleware uses a short Redis-backed negative cache for deleted users to reduce repeated DB lookups from stale cookies.
- Negative cache keys must be short-lived so a recreated user ID cannot be blocked for long.
- Cache misses or Redis failures must fail open to the DB lookup path, not fail the request pipeline.

## Protected route usage
- Route handlers under `/api/protected/*` should read the authenticated user via `readProtectedRequestUser()` or `requireProtectedRequestUser()`.
- Do not trust `x-auth-user-*` headers coming from the public internet outside middleware-forwarded requests.

## Migration direction
- The current mixed model is serviceable but not ideal long term.
- Preferred future direction: short-lived access token plus rotating refresh token flow.
- Suggested target shape:
  - access token: 5 to 15 minutes, signed, audience-scoped, no DB read for common happy path when revocation state is cached
  - refresh token: opaque or signed+hashed, stored server-side or rotated with replay detection
  - revocation: token versioning or per-session record, especially for password reset, ban, account deletion, and logout-all-devices
- Migration should preserve the invariant that deleted or banned users are rejected immediately.

## Developer checklist
- Any new auth entry point must answer: how is stale user state invalidated?
- Any new child-table write must answer: what guarantees the parent `User` still exists?
- Any new protected API route should avoid reimplementing header parsing or auth cookie clearing.