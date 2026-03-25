/** @jest-environment node */

import { activateMatchLiveState, shouldActivateCountdownMatch } from "../application/match-start";

describe("match start activation", () => {
  it("activates countdown matches at or after the authoritative start time", () => {
    expect(
      shouldActivateCountdownMatch({
        matchState: "countdown",
        nowMs: 3_000,
        serverStartAtMs: 3_000,
      })
    ).toBe(true);

    expect(
      shouldActivateCountdownMatch({
        matchState: "countdown",
        nowMs: 3_250,
        serverStartAtMs: 3_000,
      })
    ).toBe(true);
  });

  it("never activates before the start time or from a non-countdown state", () => {
    expect(
      shouldActivateCountdownMatch({
        matchState: "countdown",
        nowMs: 2_999,
        serverStartAtMs: 3_000,
      })
    ).toBe(false);

    expect(
      shouldActivateCountdownMatch({
        matchState: "waiting_for_both",
        nowMs: 3_500,
        serverStartAtMs: 3_000,
      })
    ).toBe(false);
  });

  it("promotes live state once without mutating an already-live snapshot", () => {
    const countdownState = {
      state: "countdown" as const,
      stateChangedAtMs: 1_000,
      participants: {},
      forfeitedUserId: null,
      endedReason: null,
      rematchMatchId: null,
      finalizedAtMs: null,
      reconnectUntilByUserId: {},
      deltas: [],
    };

    expect(activateMatchLiveState(countdownState, 4_000)).toEqual({
      ...countdownState,
      state: "live",
      stateChangedAtMs: 4_000,
    });

    const liveState = {
      ...countdownState,
      state: "live" as const,
      stateChangedAtMs: 5_000,
    };

    expect(activateMatchLiveState(liveState, 6_000)).toBe(liveState);
  });
});