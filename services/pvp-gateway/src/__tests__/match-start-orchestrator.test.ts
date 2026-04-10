/**
 * @file match-start-orchestrator.test.ts
 *
 * Unit tests for MatchStartOrchestrator — the single owner of all
 * match start-sequence timers (no-show, countdown tick, countdown activation).
 *
 * Uses jest.useFakeTimers() so every scenario runs synchronously.
 *
 * Scenario table:
 *  S01  arm(ranked_human) → no-show timer armed
 *  S02  arm(ranked_ai)    → countdown timers armed, no no-show
 *  S03  arm(room)         → countdown timers armed, no no-show
 *  S04  disarm()          → all timers cleared, idempotent
 *  S05  advanceToCountdown() → no-show cancelled, countdown armed
 *  S06  advanceToCountdown() called twice → second call is no-op
 *  S07  advanceToCountdown() with failing callback → no countdown armed
 *  S08  rehydrate("waiting_for_both") → no-show timer re-armed with remaining window
 *  S09  rehydrate("countdown_armed")  → countdown timers re-armed with remaining delay
 *  S10  rehydrate("live")             → no-op
 *  S11  rehydrate("countdown_armed") when already armed → no-op
 *  S12  No-show timer fires → abortNoShow callback called
 *  S13  Countdown activation timer fires → activateCountdown("timer") called
 *  S14  wireCallbacks() replaces stub callbacks
 *  S15  Stale countdown on rehydrate is skipped
 */

/** @jest-environment node */

import { MatchStartOrchestrator, productionTimerService, type MatchStartCallbacks } from "../application/match-start-orchestrator";
import { MATCH_NO_SHOW_TIMEOUT_MS, MATCH_MAX_COUNTDOWN_AGE_MS } from "../shared/config";
import type { LocalMatch } from "../shared/types";
import type { MatchId } from "../shared/branded-ids";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mid(id: string): MatchId {
  return id as MatchId;
}

/**
 * Build a minimal `LocalMatch` test fixture.
 * `serverStartAtMs` defaults to 3 s in the future from the fake clock.
 */
function makeMatch(matchId: string, overrides: Partial<LocalMatch> = {}): LocalMatch {
  const now = Date.now();
  return {
    matchId: mid(matchId),
    roomCode: null,
    state: "waiting_for_both",
    stateChangedAt: now,
    revision: 1,
    lastSnapshotBroadcastAtMs: 0,
    status: "PENDING",
    textSnapshot: "test text",
    textId: null,
    inputNonce: null,
    serverStartAtMs: now + 3_000,
    participants: new Map(),
    endedReason: null,
    forfeitedUserId: null,
    rematchMatchId: null,
    finalizedAtMs: null,
    cleanupScheduledAtMs: null,
    reconnectUntilByUserId: {},
    recentDeltas: [],
    tieWindowStartedAt: null,
    isLowConfidence: false,
    ...overrides,
  } as unknown as LocalMatch;
}

/** Build stub callbacks — all callthrough to jest.fn(). */
function makeCallbacks(overrides: Partial<MatchStartCallbacks> = {}): {
  callbacks: MatchStartCallbacks;
  stubs: { [K in keyof MatchStartCallbacks]: jest.Mock };
} {
  const stubs = {
    advanceToCountdown: jest.fn<Promise<boolean>, [MatchId]>().mockResolvedValue(true),
    activateCountdown:  jest.fn<Promise<void>, [MatchId, "timer" | "sweep" | "redis-worker" | "client-sync"]>().mockResolvedValue(undefined),
    sendCountdownTick:  jest.fn<void, [MatchId, number]>(),
    abortNoShow:        jest.fn<Promise<void>, [MatchId]>().mockResolvedValue(undefined),
  };
  const callbacks: MatchStartCallbacks = { ...stubs, ...overrides };
  return { callbacks, stubs };
}

function makeOrchestrator(callbacks?: MatchStartCallbacks) {
  const { callbacks: cb, stubs } = makeCallbacks();
  const orch = new MatchStartOrchestrator(productionTimerService, callbacks ?? cb);
  return { orch, stubs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ── S01 ──────────────────────────────────────────────────────────────────────
describe("S01 arm(ranked_human) – arms no-show timer only", () => {
  it("reports no-show armed; no countdown/tick timers", () => {
    const { orch } = makeOrchestrator();
    const match = makeMatch("m01");
    orch.arm(match, "ranked_human");

    expect(orch._getTimerCount(match.matchId, "no_show")).toBe(1);
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(0);
    expect(orch._getTimerCount(match.matchId, "tick")).toBe(0);
  });

  it("is idempotent (second arm is a no-op)", () => {
    const { orch } = makeOrchestrator();
    const match = makeMatch("m01b");
    orch.arm(match, "ranked_human");
    orch.arm(match, "ranked_human"); // second call
    expect(orch._getTimerCount(match.matchId, "no_show")).toBe(1);
  });
});

// ── S02 ──────────────────────────────────────────────────────────────────────
describe("S02 arm(ranked_ai) – arms countdown timers; no no-show", () => {
  it("reports countdown and tick timers; no no-show", () => {
    const { orch } = makeOrchestrator();
    const match = makeMatch("m02", { state: "countdown" });
    orch.arm(match, "ranked_ai");

    expect(orch._getTimerCount(match.matchId, "no_show")).toBe(0);
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(1);
    expect(orch._getTimerCount(match.matchId, "tick")).toBe(1);
  });
});

// ── S03 ──────────────────────────────────────────────────────────────────────
describe("S03 arm(room) – arms countdown timers", () => {
  it("arms countdown + tick timers", () => {
    const { orch } = makeOrchestrator();
    const match = makeMatch("m03", { state: "countdown" });
    orch.arm(match, "room");
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(1);
    expect(orch._getTimerCount(match.matchId, "tick")).toBe(1);
  });
});

// ── S04 ──────────────────────────────────────────────────────────────────────
describe("S04 disarm() – clears all timers", () => {
  it("removes no-show timer after arm(ranked_human)", () => {
    const { orch } = makeOrchestrator();
    const match = makeMatch("m04");
    orch.arm(match, "ranked_human");
    orch.disarm(match.matchId);
    expect(orch._getTimerCount(match.matchId, "no_show")).toBe(0);
  });

  it("removes countdown timers after arm(ranked_ai)", () => {
    const { orch } = makeOrchestrator();
    const match = makeMatch("m04b", { state: "countdown" });
    orch.arm(match, "ranked_ai");
    orch.disarm(match.matchId);
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(0);
    expect(orch._getTimerCount(match.matchId, "tick")).toBe(0);
  });

  it("is idempotent (double disarm does not throw)", () => {
    const { orch } = makeOrchestrator();
    const match = makeMatch("m04c");
    orch.arm(match, "ranked_human");
    orch.disarm(match.matchId);
    expect(() => orch.disarm(match.matchId)).not.toThrow();
  });
});

// ── S05 ──────────────────────────────────────────────────────────────────────
describe("S05 advanceToCountdown() – cancels no-show, arms countdown", () => {
  it("cancels no-show and arms countdown after callback resolves true", async () => {
    const { stubs } = makeCallbacks();
    const match = makeMatch("m05");
    const orch = new MatchStartOrchestrator(productionTimerService, {
      ...stubs,
      advanceToCountdown: jest.fn().mockImplementation(async () => {
        // Simulate successful DB transition: set serverStartAtMs 3 s ahead
        match.serverStartAtMs = Date.now() + 3_000;
        return true;
      }),
    });

    orch.arm(match, "ranked_human");
    expect(orch._getTimerCount(match.matchId, "no_show")).toBe(1);

    const result = await orch.advanceToCountdown(match);
    expect(result).toBe(true);
    expect(orch._getTimerCount(match.matchId, "no_show")).toBe(0);
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(1);
    expect(orch._getTimerCount(match.matchId, "tick")).toBe(1);
  });
});

// ── S06 ──────────────────────────────────────────────────────────────────────
describe("S06 advanceToCountdown() idempotency", () => {
  it("returns false on the second call — no double-arm", async () => {
    const { stubs } = makeCallbacks();
    const match = makeMatch("m06");
    match.serverStartAtMs = Date.now() + 3_000;
    const orch = new MatchStartOrchestrator(productionTimerService, {
      ...stubs,
      advanceToCountdown: jest.fn().mockResolvedValue(true),
    });

    orch.arm(match, "ranked_human");
    await orch.advanceToCountdown(match);
    const second = await orch.advanceToCountdown(match);
    expect(second).toBe(false);
    // Still only one countdown timer
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(1);
  });
});

// ── S07 ──────────────────────────────────────────────────────────────────────
describe("S07 advanceToCountdown() with failing callback", () => {
  it("rolls back countdownArmed guard when callback returns false", async () => {
    const { stubs } = makeCallbacks();
    const match = makeMatch("m07");
    const orch = new MatchStartOrchestrator(productionTimerService, {
      ...stubs,
      advanceToCountdown: jest.fn().mockResolvedValue(false),
    });

    orch.arm(match, "ranked_human");
    const result = await orch.advanceToCountdown(match);
    expect(result).toBe(false);
    // Countdown should NOT be armed — guard is rolled back
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(0);
    // A second call should be permitted (not stuck as "armed")
    stubs.advanceToCountdown = jest.fn().mockResolvedValue(true) as jest.Mock;
    match.serverStartAtMs = Date.now() + 3_000;
    // Patch callbacks
    orch.wireCallbacks({ ...stubs });
    const retry = await orch.advanceToCountdown(match);
    expect(retry).toBe(true);
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(1);
  });
});

// ── S08 ──────────────────────────────────────────────────────────────────────
describe("S08 rehydrate(waiting_for_both) – re-arms no-show", () => {
  it("arms no-show with remaining window when phase=waiting_for_both", () => {
    const { orch, stubs } = makeOrchestrator();
    const match = makeMatch("m08");
    // Simulate match created 10 s ago
    match.stateChangedAt = Date.now() - 10_000;
    const liveState = {
      state: "waiting_for_both" as const,
      stateChangedAtMs: match.stateChangedAt,
      participants: {},
      startPhase: "waiting_for_both" as const,
      forfeitedUserId: null,
      endedReason: null,
      rematchMatchId: null,
      finalizedAtMs: null,
      reconnectUntilByUserId: {},
    };

    orch.rehydrate(match, liveState);
    expect(orch._getTimerCount(match.matchId, "no_show")).toBe(1);

    // Fire the no-show timer after the remaining window
    const remaining = MATCH_NO_SHOW_TIMEOUT_MS - 10_000;
    jest.advanceTimersByTime(remaining + 100);
    expect(stubs.abortNoShow).toHaveBeenCalledWith(match.matchId);
  });
});

// ── S09 ──────────────────────────────────────────────────────────────────────
describe("S09 rehydrate(countdown_armed) – re-arms countdown", () => {
  it("arms countdown with remaining delay when phase=countdown_armed", () => {
    const { orch, stubs } = makeOrchestrator();
    const match = makeMatch("m09", { state: "countdown" });
    const serverStartAtMs = Date.now() + 2_500;
    match.serverStartAtMs = serverStartAtMs;
    const liveState = {
      state: "countdown" as const,
      stateChangedAtMs: Date.now(),
      participants: {},
      startPhase: "countdown_armed" as const,
      serverStartAtEpochMs: serverStartAtMs,
      forfeitedUserId: null,
      endedReason: null,
      rematchMatchId: null,
      finalizedAtMs: null,
      reconnectUntilByUserId: {},
    };

    orch.rehydrate(match, liveState);
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(1);
    expect(orch._getTimerCount(match.matchId, "tick")).toBe(1);

    // Fire the activation timer
    jest.advanceTimersByTime(3_000);
    expect(stubs.activateCountdown).toHaveBeenCalledWith(match.matchId, "timer");
  });
});

// ── S10 ──────────────────────────────────────────────────────────────────────
describe("S10 rehydrate(live) – no-op", () => {
  it("does not arm any timer when phase=live", () => {
    const { orch } = makeOrchestrator();
    const match = makeMatch("m10", { state: "live" });
    const liveState = {
      state: "live" as const,
      stateChangedAtMs: Date.now(),
      participants: {},
      startPhase: "live" as const,
      forfeitedUserId: null,
      endedReason: null,
      rematchMatchId: null,
      finalizedAtMs: null,
      reconnectUntilByUserId: {},
    };

    orch.rehydrate(match, liveState);
    expect(orch._getTimerCount(match.matchId, "no_show")).toBe(0);
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(0);
  });
});

// ── S11 ──────────────────────────────────────────────────────────────────────
describe("S11 rehydrate(countdown_armed) when already armed – no-op", () => {
  it("does not create a second countdown timer", () => {
    const { orch } = makeOrchestrator();
    const match = makeMatch("m11", { state: "countdown" });
    const serverStartAtMs = Date.now() + 3_000;
    match.serverStartAtMs = serverStartAtMs;
    const liveState = {
      state: "countdown" as const,
      stateChangedAtMs: Date.now(),
      participants: {},
      startPhase: "countdown_armed" as const,
      serverStartAtEpochMs: serverStartAtMs,
      forfeitedUserId: null,
      endedReason: null,
      rematchMatchId: null,
      finalizedAtMs: null,
      reconnectUntilByUserId: {},
    };

    orch.rehydrate(match, liveState);
    orch.rehydrate(match, liveState); // second call — must be no-op
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(1);
    expect(orch._getTimerCount(match.matchId, "tick")).toBe(1);
  });
});

// ── S12 ──────────────────────────────────────────────────────────────────────
describe("S12 no-show timer fires – abortNoShow callback invoked", () => {
  it("calls abortNoShow after MATCH_NO_SHOW_TIMEOUT_MS", () => {
    const { orch, stubs } = makeOrchestrator();
    const match = makeMatch("m12");
    orch.arm(match, "ranked_human");

    jest.advanceTimersByTime(MATCH_NO_SHOW_TIMEOUT_MS + 100);
    expect(stubs.abortNoShow).toHaveBeenCalledTimes(1);
    expect(stubs.abortNoShow).toHaveBeenCalledWith(match.matchId);
  });

  it("does NOT fire if disarmed before the deadline", () => {
    const { orch, stubs } = makeOrchestrator();
    const match = makeMatch("m12b");
    orch.arm(match, "ranked_human");
    orch.disarm(match.matchId);

    jest.advanceTimersByTime(MATCH_NO_SHOW_TIMEOUT_MS + 100);
    expect(stubs.abortNoShow).not.toHaveBeenCalled();
  });
});

// ── S13 ──────────────────────────────────────────────────────────────────────
describe("S13 countdown activation timer fires – activateCountdown invoked", () => {
  it("calls activateCountdown('timer') after the delay", async () => {
    const { stubs } = makeCallbacks();
    const match = makeMatch("m13", { state: "countdown" });
    const delayMs = 2_000;
    match.serverStartAtMs = Date.now() + delayMs;
    const orch = new MatchStartOrchestrator(productionTimerService, { ...stubs });

    orch.arm(match, "ranked_ai");
    jest.advanceTimersByTime(delayMs + 100);

    // Allow Promise microtasks to flush
    await Promise.resolve();
    expect(stubs.activateCountdown).toHaveBeenCalledWith(match.matchId, "timer");
  });

  it("sends COUNTDOWN_TICK every second while countdown is active", () => {
    const { orch, stubs } = makeOrchestrator();
    const match = makeMatch("m13b", { state: "countdown" });
    match.serverStartAtMs = Date.now() + 5_000;
    orch.arm(match, "room");

    jest.advanceTimersByTime(1_100);
    expect(stubs.sendCountdownTick).toHaveBeenCalled();
  });
});

// ── S14 ──────────────────────────────────────────────────────────────────────
describe("S14 wireCallbacks() – replaces stub callbacks", () => {
  it("uses wired callbacks after wireCallbacks() is called", async () => {
    const stubCb = makeCallbacks();
    const orch = new MatchStartOrchestrator(productionTimerService, stubCb.callbacks);
    const match = makeMatch("m14");
    orch.arm(match, "ranked_human");

    // Replace with new callbacks
    const realCb = makeCallbacks();
    orch.wireCallbacks(realCb.callbacks);

    jest.advanceTimersByTime(MATCH_NO_SHOW_TIMEOUT_MS + 100);
    await Promise.resolve(); // flush microtasks

    // Old stubs NOT called, new ones ARE
    expect(stubCb.stubs.abortNoShow).not.toHaveBeenCalled();
    expect(realCb.stubs.abortNoShow).toHaveBeenCalledWith(match.matchId);
  });
});

// ── S15 ──────────────────────────────────────────────────────────────────────
describe("S15 stale countdown on rehydrate – skipped", () => {
  it("does not arm timers when the countdown is too old", () => {
    const { orch } = makeOrchestrator();
    const match = makeMatch("m15", { state: "countdown" });
    const staleMs = -(MATCH_MAX_COUNTDOWN_AGE_MS + 10_000);
    const serverStartAtMs = Date.now() + staleMs;
    match.serverStartAtMs = serverStartAtMs;
    const liveState = {
      state: "countdown" as const,
      stateChangedAtMs: Date.now() + staleMs,
      participants: {},
      startPhase: "countdown_armed" as const,
      serverStartAtEpochMs: serverStartAtMs,
      forfeitedUserId: null,
      endedReason: null,
      rematchMatchId: null,
      finalizedAtMs: null,
      reconnectUntilByUserId: {},
    };

    orch.rehydrate(match, liveState);
    expect(orch._getTimerCount(match.matchId, "countdown")).toBe(0);
    expect(orch._getTimerCount(match.matchId, "tick")).toBe(0);
  });
});
