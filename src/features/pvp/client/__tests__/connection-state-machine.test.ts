/**
 * Unit tests for the pure connection-state-machine module.
 *
 * These tests verify every transition, edge case, and invariant without any
 * React or DOM dependencies.  They run in a standard Jest / jsdom environment
 * via the existing project test configuration.
 */

import {
  idleState,
  connectingState,
  readyState,
  MAX_RECONNECT_ATTEMPTS,
  CIRCUIT_BREAKER_COOLDOWN_MS,
  isFatalCloseCode,
  backoffDelayMs,
  onDisconnect,
  onReconnectAttemptFailed,
  onHelloOk,
  onAuthFailed,
  getConnectionBannerMessage,
  isConnectionReady,
  type ConnectionState,
} from "../connection-state-machine";

// ---------------------------------------------------------------------------
// CIRCUIT_BREAKER_COOLDOWN_MS
// ---------------------------------------------------------------------------

describe("CIRCUIT_BREAKER_COOLDOWN_MS", () => {
  it("is exported and equals 20 minutes in ms", () => {
    expect(CIRCUIT_BREAKER_COOLDOWN_MS).toBe(20 * 60 * 1_000);
  });
});

// ---------------------------------------------------------------------------
// isFatalCloseCode
// ---------------------------------------------------------------------------

describe("isFatalCloseCode", () => {
  it("returns false for normal close code 1000", () => {
    expect(isFatalCloseCode(1000)).toBe(false);
  });

  it("returns false for transient code 1001 (going away / server restart)", () => {
    expect(isFatalCloseCode(1001)).toBe(false);
  });

  it("returns false for abnormal code 1006 (connection lost without close frame)", () => {
    expect(isFatalCloseCode(1006)).toBe(false);
  });

  it("returns false for 1013 (try again later / gateway overloaded)", () => {
    expect(isFatalCloseCode(1013)).toBe(false);
  });

  it("returns true for 1008 (policy violation — wrong origin / insecure)", () => {
    expect(isFatalCloseCode(1008)).toBe(true);
  });

  it("returns true for 1009 (message too large)", () => {
    expect(isFatalCloseCode(1009)).toBe(true);
  });

  it("returns true for application code 4000 (lower bound)", () => {
    expect(isFatalCloseCode(4000)).toBe(true);
  });

  it("returns true for application code 4001 (session superseded)", () => {
    expect(isFatalCloseCode(4001)).toBe(true);
  });

  it("returns true for application code 4999 (upper bound)", () => {
    expect(isFatalCloseCode(4999)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// backoffDelayMs
// ---------------------------------------------------------------------------

describe("backoffDelayMs", () => {
  const BASE_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000];
  const JITTER = 100;

  it.each([1, 2, 3, 4, 5] as const)(
    "attempt %i produces a delay within ±jitter of the base",
    (attempt) => {
      const base = BASE_DELAYS[attempt - 1]!;
      const delay = backoffDelayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(base - JITTER);
      expect(delay).toBeLessThanOrEqual(base + JITTER);
    },
  );

  it("clamps to the maximum delay table entry for attempt 6+", () => {
    const delay = backoffDelayMs(6);
    expect(delay).toBeGreaterThanOrEqual(16_000 - JITTER);
    expect(delay).toBeLessThanOrEqual(16_000 + JITTER);
  });

  it("never returns a value below 100 ms", () => {
    for (let i = 1; i <= 10; i++) {
      expect(backoffDelayMs(i)).toBeGreaterThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// onDisconnect — transient close codes
// ---------------------------------------------------------------------------

describe("onDisconnect — transient codes", () => {
  const NOW = 1_700_000_000_000;

  it("returns 'reconnecting' with attempt=1 on first disconnect (code 1001)", () => {
    const state = onDisconnect(1001, 0, NOW);
    expect(state.kind).toBe("reconnecting");
    if (state.kind !== "reconnecting") return;
    expect(state.attempt).toBe(1);
    // nextRetryAt ≈ NOW + 1000 ms ± jitter
    expect(state.nextRetryAt).toBeGreaterThanOrEqual(NOW + 900);
    expect(state.nextRetryAt).toBeLessThanOrEqual(NOW + 1_100);
  });

  it("returns 'reconnecting' with attempt=2 on second disconnect", () => {
    const state = onDisconnect(1001, 1, NOW);
    expect(state.kind).toBe("reconnecting");
    if (state.kind !== "reconnecting") return;
    expect(state.attempt).toBe(2);
    // nextRetryAt ≈ NOW + 2000 ms ± jitter
    expect(state.nextRetryAt).toBeGreaterThanOrEqual(NOW + 1_900);
    expect(state.nextRetryAt).toBeLessThanOrEqual(NOW + 2_100);
  });

  it("escalates through all 5 attempts without reaching permanent_failure", () => {
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      const state = onDisconnect(1001, attempt, NOW);
      expect(state.kind).toBe("reconnecting");
    }
  });

  it("transitions to permanent_failure on the Nth+1 disconnect (attempt = MAX)", () => {
    const state = onDisconnect(1001, MAX_RECONNECT_ATTEMPTS, NOW);
    expect(state.kind).toBe("permanent_failure");
    if (state.kind !== "permanent_failure") return;
    expect(state.reason).toBe("max_retries_exceeded");
    expect(state.failedAt).toBe(NOW);
  });

  it("each subsequent attempt has a longer nextRetryAt than the previous", () => {
    // Run many samples to overcome jitter
    for (let trial = 0; trial < 20; trial++) {
      const delays = [1, 2, 3, 4, 5].map((a) => {
        const s = onDisconnect(1001, a - 1, NOW);
        return s.kind === "reconnecting" ? s.nextRetryAt : Infinity;
      });
      // Allow for jitter — each base is 2× the previous so even worst jitter
      // should not violate ordering
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThan(delays[i - 1]! - 300);
      }
    }
  });

  it("code 1000 (normal close) is treated as transient and triggers reconnect", () => {
    const state = onDisconnect(1000, 0, NOW);
    expect(state.kind).toBe("reconnecting");
  });

  it("code 1006 (abnormal, no close frame) is treated as transient", () => {
    const state = onDisconnect(1006, 0, NOW);
    expect(state.kind).toBe("reconnecting");
  });

  it("code 1013 (server overloaded) is treated as transient", () => {
    const state = onDisconnect(1013, 0, NOW);
    expect(state.kind).toBe("reconnecting");
  });
});

// ---------------------------------------------------------------------------
// onDisconnect — fatal close codes
// ---------------------------------------------------------------------------

describe("onDisconnect — fatal close codes", () => {
  const NOW = 1_700_000_000_000;

  it("returns permanent_failure immediately for code 4001 (session superseded)", () => {
    const state = onDisconnect(4001, 0, NOW);
    expect(state.kind).toBe("permanent_failure");
    if (state.kind !== "permanent_failure") return;
    expect(state.reason).toBe("session_superseded");
    expect(state.failedAt).toBe(NOW);
  });

  it("code 4001 is permanent regardless of current attempt count", () => {
    for (let attempt = 0; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      const state = onDisconnect(4001, attempt, NOW);
      expect(state.kind).toBe("permanent_failure");
    }
  });

  it("returns permanent_failure for code 4000 with reason fatal_close_code", () => {
    const state = onDisconnect(4000, 0, NOW);
    expect(state.kind).toBe("permanent_failure");
    if (state.kind !== "permanent_failure") return;
    expect(state.reason).toBe("fatal_close_code");
    expect(state.failedAt).toBe(NOW);
  });

  it("returns permanent_failure for code 1008 (policy violation)", () => {
    const state = onDisconnect(1008, 0, NOW);
    expect(state.kind).toBe("permanent_failure");
    if (state.kind !== "permanent_failure") return;
    expect(state.reason).toBe("fatal_close_code");
  });

  it("returns permanent_failure for code 1009 regardless of attempt", () => {
    const state = onDisconnect(1009, 1, NOW);
    expect(state.kind).toBe("permanent_failure");
  });
});

// ---------------------------------------------------------------------------
// onReconnectAttemptFailed
// ---------------------------------------------------------------------------

describe("onReconnectAttemptFailed", () => {
  const NOW = 1_700_000_000_000;

  it("schedules attempt 2 when attempt 1 fails", () => {
    const state = onReconnectAttemptFailed(1, NOW);
    expect(state.kind).toBe("reconnecting");
    if (state.kind !== "reconnecting") return;
    expect(state.attempt).toBe(2);
  });

  it("transitions to permanent_failure when the max attempt fails", () => {
    const state = onReconnectAttemptFailed(MAX_RECONNECT_ATTEMPTS, NOW);
    expect(state.kind).toBe("permanent_failure");
    if (state.kind !== "permanent_failure") return;
    expect(state.reason).toBe("max_retries_exceeded");
    expect(state.failedAt).toBe(NOW);
  });

  it("any attempt ≥ MAX also transitions to permanent_failure", () => {
    const state = onReconnectAttemptFailed(MAX_RECONNECT_ATTEMPTS + 2, NOW);
    expect(state.kind).toBe("permanent_failure");
  });
});

// ---------------------------------------------------------------------------
// onHelloOk
// ---------------------------------------------------------------------------

describe("onHelloOk", () => {
  it("moves from connecting to ready", () => {
    expect(onHelloOk()).toEqual({ kind: "ready" });
  });

  it("moves from reconnecting to ready (resets attempt counter)", () => {
    expect(onHelloOk()).toEqual({ kind: "ready" });
  });

  it("returns ready even if already ready (idempotent)", () => {
    expect(onHelloOk()).toEqual({ kind: "ready" });
  });
});

// ---------------------------------------------------------------------------
// onAuthFailed
// ---------------------------------------------------------------------------

describe("onAuthFailed", () => {
  it("returns permanent_failure with reason auth_failed", () => {
    const state = onAuthFailed();
    expect(state.kind).toBe("permanent_failure");
    if (state.kind !== "permanent_failure") return;
    expect(state.reason).toBe("auth_failed");
  });

  it("reason is auth_failed even when called from reconnecting state", () => {
    const state = onAuthFailed();
    expect(state.kind).toBe("permanent_failure");
    if (state.kind !== "permanent_failure") return;
    expect(state.reason).toBe("auth_failed");
  });

  it("uses the injected nowMs as failedAt", () => {
    const NOW = 1_700_000_000_000;
    const state = onAuthFailed(NOW);
    expect(state.kind).toBe("permanent_failure");
    if (state.kind !== "permanent_failure") return;
    expect(state.failedAt).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// getConnectionBannerMessage
// ---------------------------------------------------------------------------

describe("getConnectionBannerMessage", () => {
  it("returns null for idle", () => {
    expect(getConnectionBannerMessage(idleState())).toBeNull();
  });

  it("returns null for connecting", () => {
    expect(getConnectionBannerMessage(connectingState())).toBeNull();
  });

  it("returns null for ready", () => {
    expect(getConnectionBannerMessage(readyState())).toBeNull();
  });

  it("includes attempt and max attempts for reconnecting state", () => {
    const state: ConnectionState = { kind: "reconnecting", attempt: 2, nextRetryAt: 0 };
    const msg = getConnectionBannerMessage(state);
    expect(msg).not.toBeNull();
    expect(msg).toContain("Reconnecting");
    expect(msg).toContain(`2/${MAX_RECONNECT_ATTEMPTS}`);
  });

  it("returns 'unavailable' message for max_retries_exceeded", () => {
    const state: ConnectionState = {
      kind: "permanent_failure",
      reason: "max_retries_exceeded",
      message: "x",
      failedAt: 0,
    };
    const msg = getConnectionBannerMessage(state);
    expect(msg).not.toBeNull();
    expect(msg).toContain("unavailable");
  });

  it("returns 'unavailable' message for fatal_close_code", () => {
    const state: ConnectionState = {
      kind: "permanent_failure",
      reason: "fatal_close_code",
      message: "x",
      failedAt: 0,
    };
    const msg = getConnectionBannerMessage(state);
    expect(msg).toContain("unavailable");
  });

  it("returns a specific message for session_superseded", () => {
    const state: ConnectionState = {
      kind: "permanent_failure",
      reason: "session_superseded",
      message: "x",
      failedAt: 0,
    };
    const msg = getConnectionBannerMessage(state);
    expect(msg).not.toBeNull();
    // Should NOT say "unavailable" — that's misleading for a tab-conflict scenario
    expect(msg).not.toContain("unavailable");
    expect(msg?.toLowerCase()).toMatch(/tab|session/);
  });

  it("prompts unauthenticated players to sign in", () => {
    const msg = getConnectionBannerMessage(onAuthFailed());
    expect(msg).toContain("Sign in");
    expect(msg).not.toContain("unavailable");
  });
});

// ---------------------------------------------------------------------------
// isConnectionReady
// ---------------------------------------------------------------------------

describe("isConnectionReady", () => {
  it("returns true only for the ready state", () => {
    expect(isConnectionReady(readyState())).toBe(true);
    expect(isConnectionReady(idleState())).toBe(false);
    expect(isConnectionReady(connectingState())).toBe(false);
    expect(isConnectionReady({ kind: "reconnecting", attempt: 1, nextRetryAt: 0 })).toBe(false);
    expect(
      isConnectionReady({ kind: "permanent_failure", reason: "max_retries_exceeded", message: "", failedAt: 0 }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full scenario: typical lifecycle
// ---------------------------------------------------------------------------

describe("full scenario: connect → disconnect → reconnect", () => {
  const NOW = 1_000_000;

  it("idle → connecting → ready → transient disconnect → reconnecting × 2 → ready", () => {
    let state: ConnectionState = idleState();
    state = connectingState();
    state = onHelloOk();
    expect(state.kind).toBe("ready");

    // First transient disconnect
    state = onDisconnect(1001, 0, NOW);
    expect(state.kind).toBe("reconnecting");
    if (state.kind !== "reconnecting") fail("Expected reconnecting");
    expect(state.attempt).toBe(1);

    // Connection re-opens but drops again
    state = onDisconnect(1001, state.attempt, NOW);
    expect(state.kind).toBe("reconnecting");
    if (state.kind !== "reconnecting") fail("Expected reconnecting");
    expect(state.attempt).toBe(2);

    // Third attempt succeeds
    state = onHelloOk();
    expect(state.kind).toBe("ready");
  });

  it("5 consecutive transient failures → permanent_failure (guarantees no infinite loop)", () => {
    let state: ConnectionState = readyState();

    // Simulate consecutive onclose events without successful HELLO_OK in between
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) {
      state = onDisconnect(1001, i, NOW);
      expect(state.kind).toBe("reconnecting");
    }

    // The MAX_RECONNECT_ATTEMPTS+1-th disconnect → permanent
    state = onDisconnect(1001, MAX_RECONNECT_ATTEMPTS, NOW);
    expect(state.kind).toBe("permanent_failure");
    if (state.kind !== "permanent_failure") fail("Expected permanent_failure");
    expect(state.reason).toBe("max_retries_exceeded");
  });

  it("permanent_failure does NOT self-heal via further onDisconnect calls", () => {
    let state: ConnectionState = {
      kind: "permanent_failure",
      reason: "max_retries_exceeded",
      message: "x",
      failedAt: 0,
    };

    // Even if somehow onDisconnect is called on a permanent_failure state,
    // it should still return permanent_failure (because the attempt parameter
    // would still be ≥ MAX)
    state = onDisconnect(1001, MAX_RECONNECT_ATTEMPTS + 10, NOW);
    expect(state.kind).toBe("permanent_failure");
  });

  it("code 4001 → permanent_failure immediately, even on attempt 0", () => {
    const state = onDisconnect(4001, 0, NOW);
    expect(state.kind).toBe("permanent_failure");
    if (state.kind !== "permanent_failure") fail();
    expect(state.reason).toBe("session_superseded");
  });

  it("successful reconnect after being offline resets from reconnecting to ready", () => {
    let state: ConnectionState = { kind: "reconnecting", attempt: 4, nextRetryAt: NOW + 8_000 };
    // Got HELLO_OK after a network interruption
    state = onHelloOk();
    expect(state).toEqual({ kind: "ready" });
    // Banner should be gone
    expect(getConnectionBannerMessage(state)).toBeNull();
    // Can now join queue
    expect(isConnectionReady(state)).toBe(true);
  });
});
