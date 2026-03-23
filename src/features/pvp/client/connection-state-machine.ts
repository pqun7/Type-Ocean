/**
 * @module connection-state-machine
 *
 * Pure, zero-React, zero-side-effect state machine for the PvP WebSocket
 * connection lifecycle.
 *
 * States
 * ------
 *   idle             – no connection attempt in progress
 *   connecting       – opening the socket / authenticating (HELLO pending)
 *   ready            – HELLO_OK received; connection fully operational
 *   reconnecting     – waiting before the next automatic reconnect attempt
 *   permanent_failure – irrecoverable; no further automatic retry
 *
 * All transitions are pure functions that accept the current state (or
 * relevant fields) and return a new state object.  Nothing is mutated.
 *
 * Design principles
 * -----------------
 * - Close codes < 4000 and not in FATAL_CLOSE_CODES are *transient*: the
 *   client should retry with exponential backoff up to MAX_RECONNECT_ATTEMPTS.
 * - Close code 4001 (session superseded — another tab took over) is treated as
 *   a *permanent* failure with a specific reason so the UI can show an
 *   actionable message rather than just "unavailable".
 * - All other application-defined codes (4000–4999) are treated as permanent
 *   policy failures.
 * - Auth failures (bad token, banned user) surface as permanent failures so
 *   the user is not stuck in an infinite reconnect loop.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of automatic reconnect attempts before entering permanent_failure. */
export const MAX_RECONNECT_ATTEMPTS = 5 as const;

/**
 * How long (ms) the circuit breaker blocks all reconnect attempts after a
 * `permanent_failure`.  Only applies to `max_retries_exceeded` and
 * `fatal_close_code` — auth / session failures allow immediate retry.
 */
export const CIRCUIT_BREAKER_COOLDOWN_MS = 1_200_000 as const; // 20 minutes

/**
 * Base backoff delays (ms) indexed by attempt number (1-based).
 * Actual delay = BASE_DELAYS_MS[attempt - 1] + jitter in [−JITTER_MS, +JITTER_MS].
 */
const BASE_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

/** Half-width of the uniform jitter added to each backoff step (±JITTER_MS). */
const JITTER_MS = 100 as const;

/**
 * WebSocket close codes that represent a permanent, non-retriable failure.
 *
 * - 1008 = Policy violation (wrong origin / insecure transport).
 * - 1009 = Message too large (misconfiguration; should never be client-side).
 *
 * All application-defined codes (4000–4999) are also treated as fatal below.
 */
const FATAL_CLOSE_CODES = new Set([1008, 1009]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Discriminator for why a permanent failure occurred. */
export type PermanentFailureReason =
  | "max_retries_exceeded"
  | "fatal_close_code"
  | "session_superseded"
  | "auth_failed";

/** Top-level discriminated union describing every possible connection state. */
export type ConnectionState =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting" }
  | { readonly kind: "ready" }
  | {
      readonly kind: "reconnecting";
      /** 1-based attempt counter (1 = first retry after initial disconnect). */
      readonly attempt: number;
      /** Epoch ms when the next reconnect should be scheduled. */
      readonly nextRetryAt: number;
    }
  | {
      readonly kind: "permanent_failure";
      readonly reason: PermanentFailureReason;
      /** Human-readable description for logging and display. */
      readonly message: string;
      /** Epoch ms when this failure was recorded. Used for circuit breaker and "X min ago" UI. */
      readonly failedAt: number;
    };

// ---------------------------------------------------------------------------
// State constructors
// ---------------------------------------------------------------------------

/** Returns the initial idle state. */
export function idleState(): ConnectionState {
  return { kind: "idle" };
}

/** Returns the connecting (HELLO pending) state. */
export function connectingState(): ConnectionState {
  return { kind: "connecting" };
}

/** Returns the fully operational ready state. */
export function readyState(): ConnectionState {
  return { kind: "ready" };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the given WebSocket close code should be treated as a
 * non-retriable permanent failure (no automatic reconnect).
 *
 * - Application-defined codes (4000–4999) are always fatal.
 * - Specific standard codes in {@link FATAL_CLOSE_CODES} are also fatal.
 */
export function isFatalCloseCode(code: number): boolean {
  if (code >= 4000) return true;
  return FATAL_CLOSE_CODES.has(code);
}

/**
 * Compute the jittered exponential backoff delay (ms) for the given 1-based
 * attempt number.  Clamps to the longest defined delay for attempts beyond the
 * lookup table, and ensures the result never goes below 100 ms.
 */
export function backoffDelayMs(attempt: number): number {
  const index = Math.min(attempt, BASE_DELAYS_MS.length) - 1;
  const base = BASE_DELAYS_MS[index] ?? BASE_DELAYS_MS[BASE_DELAYS_MS.length - 1];
  // Uniform jitter in the range [−JITTER_MS, +JITTER_MS]
  const jitter = Math.floor(Math.random() * (JITTER_MS * 2 + 1)) - JITTER_MS;
  return Math.max(100, base + jitter);
}

// ---------------------------------------------------------------------------
// Transition functions
// ---------------------------------------------------------------------------

/**
 * Transition to use when the provider initiates (or re-initiates) a
 * connection attempt, e.g. on first mount or manual retry.
 */
export function startConnecting(): ConnectionState {
  return connectingState();
}

/**
 * Transition to use when HELLO_OK is received from the server.
 * Resets the reconnect attempt counter and moves to `ready`.
 */
export function onHelloOk(): ConnectionState {
  return readyState();
}

/**
 * Transition to use when the WebSocket's `close` event fires.
 *
 * @param closeCode     The `CloseEvent.code` from the browser.
 * @param currentAttempt  Number of reconnect attempts already exhausted (0 after
 *                        the initial connection drop, N after N retries).
 * @param nowMs         Current epoch ms — injected for deterministic tests.
 */
export function onDisconnect(
  closeCode: number,
  currentAttempt: number,
  nowMs = Date.now(),
): ConnectionState {
  // 4001 = "Superseded by a newer match session" (another tab authenticated).
  // Treat specially so the UI can show a specific, actionable message.
  if (closeCode === 4001) {
    return {
      kind: "permanent_failure",
      reason: "session_superseded",
      message: "Your session was taken over by another tab. Close the other tab and reconnect.",
      failedAt: nowMs,
    };
  }

  if (isFatalCloseCode(closeCode)) {
    return {
      kind: "permanent_failure",
      reason: "fatal_close_code",
      message: `Connection closed with non-retriable code ${closeCode}.`,
      failedAt: nowMs,
    };
  }

  // Transient close — schedule a retry if attempts remain.
  const nextAttempt = currentAttempt + 1;

  if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
    return {
      kind: "permanent_failure",
      reason: "max_retries_exceeded",
      message: `Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts.`,
      failedAt: nowMs,
    };
  }

  return {
    kind: "reconnecting",
    attempt: nextAttempt,
    nextRetryAt: nowMs + backoffDelayMs(nextAttempt),
  };
}

/**
 * Transition to use when a reconnect attempt itself fails *before* the socket
 * even opens (e.g., token-fetch error, WebSocket constructor exception).
 *
 * @param attempt  The 1-based attempt number that just failed.
 * @param nowMs    Current epoch ms — injected for deterministic tests.
 */
export function onReconnectAttemptFailed(
  attempt: number,
  nowMs = Date.now(),
): ConnectionState {
  if (attempt >= MAX_RECONNECT_ATTEMPTS) {
    return {
      kind: "permanent_failure",
      reason: "max_retries_exceeded",
      message: `Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts.`,
      failedAt: nowMs,
    };
  }

  const nextAttempt = attempt + 1;
  return {
    kind: "reconnecting",
    attempt: nextAttempt,
    nextRetryAt: nowMs + backoffDelayMs(nextAttempt),
  };
}

/**
 * Transition to use when authentication fails during the HELLO phase
 * (expired token, banned user, bad secret, etc.).
 */
export function onAuthFailed(nowMs = Date.now()): ConnectionState {
  return {
    kind: "permanent_failure",
    reason: "auth_failed",
    message: "Authentication failed. Please refresh the page and try again.",
    failedAt: nowMs,
  };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Derive the single, human-readable status banner message for the connection
 * state.  Returns `null` when no banner should be displayed (connection is
 * healthy or in the initial connecting phase).
 *
 * Consumers should render **exactly one** message at a time based on this
 * value — never show multiple connection-related banners simultaneously.
 */
export function getConnectionBannerMessage(state: ConnectionState): string | null {
  switch (state.kind) {
    case "reconnecting":
      return `Reconnecting to ranked queue... (attempt ${state.attempt}/${MAX_RECONNECT_ATTEMPTS})`;

    case "permanent_failure":
      // Session-superseded gets a more specific, actionable message.
      if (state.reason === "session_superseded") {
        return "This session was taken over by another tab. Close the other tab and click Retry.";
      }
      return "The match server is currently unavailable. Matchmaking is paused — please try again shortly.";

    case "idle":
    case "connecting":
    case "ready":
      return null;
  }
}

/**
 * Returns `true` when the state represents a fully operational connection that
 * can accept matchmaking actions (queue join, etc.).
 */
export function isConnectionReady(state: ConnectionState): boolean {
  return state.kind === "ready";
}
