/**
 * @module shared/config
 *
 * Centralised environment-variable helpers and gateway configuration constants.
 *
 * ## Import policy
 * This module has **zero internal imports** — it is the lowest layer of the
 * dependency graph and must remain free of any imports from other gateway
 * modules.  Only Node built-ins and pure-computation logic are allowed.
 *
 * ## Adding a new constant
 * 1. Declare it here with an `env*` helper.
 * 2. Export it.
 * 3. Import it in the consuming module.
 * Never declare constants inline in handler files — that defeats the purpose
 * of a central config layer.
 */

// =============================================================================
// ENVIRONMENT HELPERS
// =============================================================================

/**
 * Reads an environment variable as an integer.
 *
 * @param name - Env variable name.
 * @param fallback - Value used when the variable is absent or not a valid number.
 * @returns Floored integer or `fallback`.
 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/**
 * Reads an environment variable as a boolean.
 *
 * Truthy strings: `"1"`, `"true"`, `"yes"`, `"y"`, `"on"`.
 * Falsy strings: `"0"`, `"false"`, `"no"`, `"n"`, `"off"`.
 *
 * @param name - Env variable name.
 * @param fallback - Value used when the variable is absent or unrecognised.
 */
export function envBool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

/**
 * Reads an environment variable as a millisecond duration (integer).
 *
 * @param name - Env variable name.
 * @param fallbackMs - Duration in milliseconds used when the variable is absent
 *   or not a valid positive number.
 * @returns At least `1 ms`, or `fallbackMs`.
 */
export function envMs(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallbackMs;
}

// =============================================================================
// RUNTIME FLAGS
// =============================================================================

/** `true` when `NODE_ENV === "production"`. */
export const IS_PROD = process.env.NODE_ENV === "production";

/** `true` in any non-production environment. */
export const DEV_MODE = process.env.NODE_ENV !== "production";

/**
 * `true` when `PVP_TRUST_PROXY_TLS=1` is set.  Tells the gateway to trust
 * `X-Forwarded-Proto: https` from a reverse proxy and skip its own TLS cert.
 */
export const TRUST_PROXY_TLS = envBool("PVP_TRUST_PROXY_TLS", false);

/**
 * `true` when `PVP_INSECURE_LOCALHOST=1` is set.  Relaxes origin and TLS
 * checks for local development without HTTPS.
 */
export const INSECURE_LOCALHOST = envBool("PVP_INSECURE_LOCALHOST", false);

function createInstanceId(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === "function") {
    return randomUuid.call(globalThis.crypto);
  }

  return `pvp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Unique instance identifier — used in liveState and metrics to distinguish
 * multiple gateway replicas.
 */
export const INSTANCE_ID = process.env.PVP_INSTANCE_ID ?? createInstanceId();

/**
 * Auth-bypass mode for testing — set `PVP_TEST_BYPASS_AUTH=true` and ensure
 * `NODE_ENV !== "production"`.
 */
export const TEST_BYPASS =
  process.env.PVP_TEST_BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production";

/** True when `PVP_TEST_FORCE_BOT_MATCH=1` in dev mode. */
export const FORCE_BOT_MATCH_LOCAL = DEV_MODE && envBool("PVP_TEST_FORCE_BOT_MATCH", false);

/**
 * Skip all WebSocket rate-limit checks in non-production environments.
 * Set `DEV_BYPASS_RATE_LIMIT=true` to enable — intended for AI-stress load tests
 * that run 12–15 VUs from the same IP.  Has no effect in production.
 */
export const DEV_BYPASS_RATE_LIMIT = DEV_MODE && envBool("DEV_BYPASS_RATE_LIMIT", false);

// =============================================================================
// WEBSOCKET METRICS BUCKETS
// =============================================================================

/** Histogram buckets for WS batch flush sizes (number of messages per flush). */
export const WS_BATCH_FLUSH_SIZE_BUCKETS = [1, 2, 4, 8, 16, 32, 64] as const;

/** Histogram buckets for WebSocket message sizes in bytes. */
export const WS_MESSAGE_SIZE_BUCKETS = [
  64, 128, 256, 512, 1024, 2048, 4096, 8192,
] as const;

// =============================================================================
// MATCH LIFECYCLE TIMINGS
// =============================================================================

/**
 * Grace period (ms) before a disconnected player is forfeited.
 * Default 35 s to allow slow mobile reconnects.
 */
export const DISCONNECT_FORFEIT_GRACE_MS = envInt("PVP_DISCONNECT_FORFEIT_GRACE_MS", 35_000);

/**
 * How long a new MATCH_JOIN is allowed to supersede an existing session for
 * the same user on the same match (handles tab reloads).
 */
export const MATCH_SESSION_SUPERSEDE_GRACE_MS = envMs(
  "PVP_MATCH_SESSION_SUPERSEDE_GRACE_MS",
  5_000,
);

/** Maximum number of delta events a reconnecting client can replay. */
export const MATCH_RESUME_DELTA_LIMIT = envInt("PVP_MATCH_RESUME_DELTA_LIMIT", 10);

/** Maximum number of deltas buffered per match before oldest are dropped. */
export const MATCH_DELTA_BUFFER_LIMIT = envInt("PVP_MATCH_DELTA_BUFFER_LIMIT", 12);

/** How long finished match data is retained in memory after finalization (ms). */
export const MATCH_RESULT_RETENTION_MS = envMs(
  "PVP_MATCH_RESULT_RETENTION_MS",
  5 * 60 * 1_000,
);

/**
 * Tie-detection window (ms) after the first participant finishes.
 * If a second participant finishes within this window, the result is treated
 * as a draw (aScore: 0.5) instead of a win/loss.
 */
export const MATCH_TIE_WINDOW_MS = envMs("PVP_MATCH_TIE_WINDOW_MS", 500);

/** Interval (ms) between stale-match sweep cycles. */
export const MATCH_SWEEP_INTERVAL_MS = envMs("PVP_MATCH_SWEEP_INTERVAL_MS", 30_000);

/** Maximum age (ms) of a match in `countdown` state before it is aborted. */
export const MATCH_MAX_COUNTDOWN_AGE_MS = envMs(
  "PVP_MATCH_MAX_COUNTDOWN_AGE_MS",
  2 * 60 * 1_000,
);

/** Maximum age (ms) of a live match before it is aborted as stale. */
export const MATCH_MAX_LIVE_AGE_MS = envMs("PVP_MATCH_MAX_LIVE_AGE_MS", 30 * 60 * 1_000);

/**
 * Time (ms) a player has to join a match after MATCH_FOUND is sent.
 * After this timeout the match is cancelled with `no_show`.
 */
export const MATCH_NO_SHOW_TIMEOUT_MS = envMs("PVP_MATCH_NO_SHOW_TIMEOUT_MS", 40_000);

// =============================================================================
// MATCH START DELAYS
// =============================================================================

/**
 * Delay (ms) between match creation and countdown start for ranked 1v1.
 * 5000ms gives a comfortable 2s buffer above the visible 3-second countdown
 * window, absorbing client/server clock skew and network round-trip latency
 * without any user-visible increase (keyboard is locked during this window).
 * Applied uniformly regardless of bot vs. human opponent so the local dev
 * experience (FORCE_BOT_MATCH_LOCAL) matches production behaviour.
 *
 * Dev default (FORCE_BOT_MATCH_LOCAL): 9500ms — the Pvp1v1Client opponent-
 * reveal animation takes 4600ms before it navigates to the match page, and
 * the subsequent page-load + WebSocket handshake + MATCH_JOIN round-trip adds
 * another ~2–4s, so a 3500ms delay caused the countdown to fire before the
 * player arrived, showing no countdown on first entry from /pvp/1v1.
 */
export const RANKED_MATCH_START_DELAY_MS = envMs(
  "PVP_RANKED_MATCH_START_DELAY_MS",
  FORCE_BOT_MATCH_LOCAL ? 9_500 : 5_000,
);

/** Delay (ms) between room-match creation and countdown start. */
export const ROOM_MATCH_START_DELAY_MS = envMs(
  "PVP_ROOM_MATCH_START_DELAY_MS",
  FORCE_BOT_MATCH_LOCAL ? 9_500 : 5_000,
);

// =============================================================================
// ROOM CONFIGURATION
// =============================================================================

/** How long a room remains valid when no activity occurs. */
export const ROOM_INACTIVITY_TTL_MS = envMs(
  "PVP_ROOM_INACTIVITY_TTL_MS",
  60 * 60 * 1_000,
);

/**
 * Grace period (ms) during which a disconnected room member's slot is
 * reserved.
 */
export const ROOM_RECONNECT_GRACE_MS = envMs("PVP_ROOM_RECONNECT_GRACE_MS", 30_000);

/** How often the room sweep runs (ms). */
export const ROOM_SWEEP_INTERVAL_MS = envMs("PVP_ROOM_SWEEP_INTERVAL_MS", 2_000);

// =============================================================================
// REDIS / ONLINE PRESENCE
// =============================================================================

/** Redis key prefix for online player presence entries. */
export const ONLINE_KEY_PREFIX = "pvp:online:" as const;

/** Redis key used to gate concurrent room sweep workers. */
export const ROOM_SWEEP_LOCK_KEY = "pvp:room:sweep:lock" as const;

/** Redis sorted-set key for durable disconnect-forfeit timer deadlines. */
export const DISCONNECT_FORFEIT_QUEUE_KEY = "pvp:disconnect:forfeit:tasks" as const;

/** Redis sorted-set key for durable no-show timer deadlines. */
export const NOSHOW_QUEUE_KEY = "pvp:noshow:tasks" as const;

/** How often (ms) the forfeit-queue Redis poller fires after gateway restart. */
export const FORFEIT_TIMER_POLL_MS = envMs("PVP_FORFEIT_TIMER_POLL_MS", 1_000);

/** How often (ms) the no-show-queue Redis poller fires after gateway restart. */
export const NOSHOW_TIMER_POLL_MS = envMs("PVP_NOSHOW_TIMER_POLL_MS", 2_000);

// =============================================================================
// PROGRESSIVE MATCHMAKING — BOT FALLBACK TIMING
// =============================================================================

/**
 * Minimum wait (ms) before a bot-fallback match is created for a queued player
 * who found no human opponent.  Corresponds to the start of the 90–120 s
 * randomised window.
 *
 * Override via `PVP_AI_QUEUE_TIMEOUT_MIN_MS`.
 * Default: 90 s (production).  Unaffected by FORCE_BOT_MATCH_LOCAL — use
 * that flag to bypass the queue entirely instead.
 */
export const AI_QUEUE_TIMEOUT_MIN_MS = envMs("PVP_AI_QUEUE_TIMEOUT_MIN_MS", 90_000);

/**
 * Maximum wait (ms) for the randomised bot-fallback window.
 * The actual timeout is drawn uniformly from [MIN, MAX] so different players
 * get staggered delays, reducing thundering-herd bot creation.
 *
 * Override via `PVP_AI_QUEUE_TIMEOUT_MAX_MS`.
 * Default: 120 s (production).
 */
export const AI_QUEUE_TIMEOUT_MAX_MS = envMs("PVP_AI_QUEUE_TIMEOUT_MAX_MS", 120_000);

/**
 * Returns a randomised bot-fallback delay for the current queue session.
 *
 * Production: uniform random value in [`AI_QUEUE_TIMEOUT_MIN_MS`, `AI_QUEUE_TIMEOUT_MAX_MS`].
 * Dev + `PVP_TEST_FORCE_BOT_MATCH=true`: returns `0` (bot is created
 * immediately via the shortcut path and never reaches this timer).
 *
 * Called once per QUEUE_JOIN to give each user their own staggered delay.
 */
export function getBotFallbackDelayMs(): number {
  const min = AI_QUEUE_TIMEOUT_MIN_MS;
  const max = Math.max(min, AI_QUEUE_TIMEOUT_MAX_MS);
  return min + Math.floor(Math.random() * (max - min + 1));
}

// =============================================================================
// MATCHMAKING PREFERENCES TABLE
// =============================================================================

/** How long (ms) to wait before re-checking for the preferences table. */
export const PVP_PREFERENCE_TABLE_RETRY_MS = 60_000;

/** The Postgres table name for per-user matchmaking preferences. */
export const PVP_MATCHMAKING_PREFERENCES_TABLE = "pvp_matchmaking_preferences" as const;

// =============================================================================
// UTILITY: Room expiry date
// =============================================================================

/**
 * Returns a `Date` object representing when a refreshed room entry expires.
 * Defined here (rather than in a handler) so all rooms use the same expiry
 * calculation.
 */
export function nextRoomExpiryDate(): Date {
  return new Date(Date.now() + ROOM_INACTIVITY_TTL_MS);
}
