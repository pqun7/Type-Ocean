import "server-only";

import { NextRequest } from "next/server";

/**
 * Validates that a state-changing request originates from the same origin as
 * this server.
 *
 * Security model:
 * - We require that at least one of the `Origin` or `Referer` headers is
 *   present and matches the server's own origin.
 * - If *both* headers are absent we reject the request. A legitimate browser
 *   always sends at least one of them for cross-origin-capable methods
 *   (POST, PATCH, PUT, DELETE). Absence is a strong signal of a non-browser
 *   or deliberately stripped request.
 *
 * This is a defence-in-depth measure on top of NextAuth's httpOnly session
 * cookie (SameSite=Lax). It is intentionally lightweight — no CSRF token
 * roundtrip is required.
 *
 * @returns `null` on success, or an error string describing the violation.
 */
export function validateCsrf(req: NextRequest): string | null {
  const origin = req.headers.get("origin") ?? "";
  const referer = req.headers.get("referer") ?? "";
  const host = new URL(req.url).origin;

  // Reject if the Origin header is present but does not match.
  if (origin && origin !== host) return "Invalid origin";

  // Reject if the Referer header is present but does not start with our host.
  if (referer && !referer.startsWith(host)) return "Invalid referer";

  // Reject if BOTH headers are absent — browser always sends at least one.
  if (!origin && !referer) return "Missing origin and referer";

  return null;
}
