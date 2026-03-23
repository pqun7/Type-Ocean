/**
 * @module shared/logger
 *
 * Thin, typed wrappers around the shared `gatewayLogger` for the PvP gateway.
 *
 * ## Contract
 * - `gatewayLogDebug` — emits only in `development` (silenced in production).
 * - `gatewayLogInfo`  — always emitted.
 * - `gatewayLogWarn`  — always emitted; use for recoverable anomalies.
 * - `gatewayLogError` — always emitted; include the `Error` object so the
 *   downstream logger can capture a stack trace.
 *
 * ## Import policy
 * This module imports only from `../../../src/log/gatewayLogger` (the Next.js
 * app's shared logger) and the `shared/config` module.  It must never import
 * from other gateway modules (would create a circular dependency).
 */

import { gatewayLogger } from "../../../../src/log/gatewayLogger";
import {
  PVP_MATCHMAKING_PREFERENCES_TABLE,
  PVP_PREFERENCE_TABLE_RETRY_MS,
} from "./config";

// =============================================================================
// MODULE-LEVEL MUTABLE FLAGS
// =============================================================================

/**
 * Tracks whether the "preference table missing" warning has been emitted.
 * Reset never — this is intentionally a one-shot warning per process.
 *
 * @internal Use {@link logMissingGatewayPreferenceTableOnce} instead.
 */
let _hasLoggedMissingPreferenceTableWarning = false;

/**
 * Resets the "preference table missing" warning flag.
 * Exposed for unit testing only.
 *
 * @internal
 */
export function _resetMissingPreferenceTableWarningForTest(): void {
  _hasLoggedMissingPreferenceTableWarning = false;
}

// =============================================================================
// LOGGING WRAPPERS
// =============================================================================

/** Prefix attached to every gateway log message for easy log filtering. */
const PREFIX = "[PVP-GATEWAY]" as const;

/**
 * Logs a debug-level message.
 * **No-op in production** (`NODE_ENV !== "development"`).
 *
 * @param message - Human-readable description.
 * @param meta    - Optional structured key-value pairs for context.
 */
export function gatewayLogDebug(
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV !== "development") return;
  gatewayLogger.debug(`${PREFIX} ${message}`, meta);
}

/**
 * Logs an informational message — always emitted.
 *
 * @param message - Human-readable description.
 * @param meta    - Optional structured key-value pairs for context.
 */
export function gatewayLogInfo(
  message: string,
  meta?: Record<string, unknown>,
): void {
  gatewayLogger.info(`${PREFIX} ${message}`, meta);
}

/**
 * Logs a warning — always emitted.  Use for recoverable anomalies that
 * operators should be aware of but that don't require immediate action.
 *
 * @param message - Human-readable description.
 * @param meta    - Optional structured key-value pairs for context.
 */
export function gatewayLogWarn(
  message: string,
  meta?: Record<string, unknown>,
): void {
  gatewayLogger.warn(`${PREFIX} ${message}`, meta);
}

/**
 * Logs an error — always emitted.  Always include the `error` argument so
 * the downstream logger captures a full stack trace.
 *
 * **Policy**: This function must never be passed `undefined` as the error.
 * If you only have a string, wrap it: `new Error("description")`.
 *
 * @param message - Human-readable context description.
 * @param error   - The caught error value (may be `unknown`).
 * @param meta    - Optional structured key-value pairs for context.
 */
export function gatewayLogError(
  message: string,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  gatewayLogger.error(`${PREFIX} ${message}`, error, meta);
}

// =============================================================================
// MATCHMAKING PREFERENCE TABLE HELPERS
// =============================================================================

/**
 * Returns `true` if `error` represents a Postgres "relation does not exist"
 * error (code `42P01`) for the matchmaking-preferences table.
 *
 * This table is optional — it may not exist on freshly-migrated deployments
 * that have not yet run the preferences migration.
 *
 * @param error - Any caught value (may be `unknown`).
 */
export function isMissingPvpMatchmakingPreferenceTable(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    meta?: { table?: unknown };
    message?: unknown;
  } | null;
  if (!candidate || typeof candidate !== "object") return false;

  const code = String(candidate.code ?? "");
  const table = String(candidate.meta?.table ?? "").toLowerCase();
  const message = String(candidate.message ?? "").toLowerCase();

  if (code === "42P01") {
    if (table.includes(PVP_MATCHMAKING_PREFERENCES_TABLE)) return true;
    if (message.includes(PVP_MATCHMAKING_PREFERENCES_TABLE)) return true;
  }

  return (
    message.includes(`relation "${PVP_MATCHMAKING_PREFERENCES_TABLE}"`) &&
    message.includes("does not exist")
  );
}

/**
 * Emits a one-shot structured warning when the matchmaking preferences table
 * is absent.  Subsequent calls within the same process lifetime are no-ops.
 *
 * Prevents log spam during periods when the table is being migrated in.
 * The retry cadence is controlled by {@link PVP_PREFERENCE_TABLE_RETRY_MS}.
 */
export function logMissingGatewayPreferenceTableOnce(): void {
  if (_hasLoggedMissingPreferenceTableWarning) return;
  _hasLoggedMissingPreferenceTableWarning = true;

  gatewayLogWarn(
    "Using default matchmaking preferences because the preference table is missing",
    {
      migrationHint: `Run db migrations to add ${PVP_MATCHMAKING_PREFERENCES_TABLE}`,
      retryAfterMs: PVP_PREFERENCE_TABLE_RETRY_MS,
    },
  );
}
