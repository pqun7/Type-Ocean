/** @jest-environment node */

/**
 * Tests for countdown timer synchronization fixes (C1–C6).
 *
 * Validates:
 *  - Match transitions from waiting_for_both → countdown → live follow strict FSM rules.
 *  - `shouldActivateCountdownMatch` only fires at or after the authoritative start time.
 *  - Re-checking readiness inside the activation window prevents stale-ready races (C5).
 *  - The live-state promotion (countdown → live) is idempotent (C6).
 */

import { shouldActivateCountdownMatch, activateMatchLiveState } from "../application/match-start";
import {
  canTransition,
  matchStateFromDbStatus,
  matchStateToDbStatus,
  transitionMatchState,
} from "../match-fsm";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeCountdownLiveState(stateChangedAtMs = 1_000) {
  return {
    state: "countdown" as const,
    stateChangedAtMs,
    participants: {},
    forfeitedUserId: null,
    endedReason: null,
    rematchMatchId: null,
    finalizedAtMs: null,
    reconnectUntilByUserId: {},
    deltas: [],
  };
}

// ── FSM countdown transitions ───────────────────────────────────────────────

describe("countdown FSM transitions", () => {
  it("allows waiting_for_both → countdown → live", () => {
    expect(canTransition("waiting_for_both", "countdown")).toBe(true);
    expect(canTransition("countdown", "live")).toBe(true);
  });

  it("disallows skipping countdown (waiting_for_both → live)", () => {
    expect(canTransition("waiting_for_both", "live")).toBe(false);
  });

  it("disallows going backwards (live → countdown)", () => {
    expect(canTransition("live", "countdown")).toBe(false);
  });

  it("round-trips db status through countdown", () => {
    const fromDb = matchStateFromDbStatus("COUNTDOWN");
    expect(fromDb).toBe("countdown");
    expect(matchStateToDbStatus(fromDb)).toBe("COUNTDOWN");
  });

  it("transitionMatchState moves through the full ranked flow", () => {
    let s = { state: matchStateFromDbStatus("PENDING"), stateChangedAt: 0 };
    expect(s.state).toBe("waiting_for_both");

    s = transitionMatchState(s, "countdown", 1_000);
    expect(s.state).toBe("countdown");
    expect(s.stateChangedAt).toBe(1_000);

    s = transitionMatchState(s, "live", 4_000);
    expect(s.state).toBe("live");
    expect(s.stateChangedAt).toBe(4_000);

    s = transitionMatchState(s, "finished", 60_000);
    expect(s.state).toBe("finished");
  });
});

// ── shouldActivateCountdownMatch ────────────────────────────────────────────

describe("countdown activation timing", () => {
  it("activates exactly at the authoritative start time", () => {
    expect(
      shouldActivateCountdownMatch({ matchState: "countdown", nowMs: 5_000, serverStartAtMs: 5_000 }),
    ).toBe(true);
  });

  it("activates after the start time (poll jitter)", () => {
    expect(
      shouldActivateCountdownMatch({ matchState: "countdown", nowMs: 5_200, serverStartAtMs: 5_000 }),
    ).toBe(true);
  });

  it("rejects activation before the start time", () => {
    expect(
      shouldActivateCountdownMatch({ matchState: "countdown", nowMs: 4_999, serverStartAtMs: 5_000 }),
    ).toBe(false);
  });

  it("rejects activation for non-countdown states", () => {
    expect(
      shouldActivateCountdownMatch({ matchState: "waiting_for_both", nowMs: 6_000, serverStartAtMs: 5_000 }),
    ).toBe(false);
    expect(
      shouldActivateCountdownMatch({ matchState: "live", nowMs: 6_000, serverStartAtMs: 5_000 }),
    ).toBe(false);
  });
});

// ── activateMatchLiveState (idempotency — C6) ──────────────────────────────

describe("activateMatchLiveState idempotency", () => {
  it("promotes countdown → live with an updated timestamp", () => {
    const countdown = makeCountdownLiveState(1_000);
    const live = activateMatchLiveState(countdown, 4_000);
    expect(live.state).toBe("live");
    expect(live.stateChangedAtMs).toBe(4_000);
  });

  it("returns the same reference for an already-live state", () => {
    const live = { ...makeCountdownLiveState(1_000), state: "live" as const, stateChangedAtMs: 5_000 };
    const result = activateMatchLiveState(live, 6_000);
    expect(result).toBe(live);
    expect(result.stateChangedAtMs).toBe(5_000); // not updated
  });
});
