/** @jest-environment node */

import {
  getDisconnectForfeitPolicy,
  getStaleMatchAbortReason,
  shouldRejectDuplicateMatchTab,
  shouldScheduleDisconnectForfeit,
} from "../../services/pvp-gateway/src/match-session-guards";

describe("pvp match session guards", () => {
  it("rejects opening the same match in another tab", () => {
    expect(shouldRejectDuplicateMatchTab(1)).toBe(true);
    expect(shouldRejectDuplicateMatchTab(0)).toBe(false);
  });

  it("schedules disconnect forfeit only for active 1v1 matches with no remaining sockets", () => {
    expect(
      shouldScheduleDisconnectForfeit({
        policy: "grace_resume",
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: "live",
        matchStatus: "RUNNING",
      })
    ).toBe(true);

    expect(
      shouldScheduleDisconnectForfeit({
        policy: "grace_resume",
        participantCount: 2,
        otherActiveSocketsForUser: 1,
        matchState: "live",
        matchStatus: "RUNNING",
      })
    ).toBe(false);

    expect(
      shouldScheduleDisconnectForfeit({
        policy: "grace_resume",
        participantCount: 3,
        otherActiveSocketsForUser: 0,
        matchState: "live",
        matchStatus: "RUNNING",
      })
    ).toBe(false);

    expect(
      shouldScheduleDisconnectForfeit({
        policy: "grace_resume",
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: "live",
        matchStatus: "FINISHED",
      })
    ).toBe(false);

    expect(
      shouldScheduleDisconnectForfeit({
        policy: "immediate_forfeit",
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: "live",
        matchStatus: "RUNNING",
      })
    ).toBe(false);

    expect(
      shouldScheduleDisconnectForfeit({
        policy: "grace_resume",
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: "countdown",
        matchStatus: "COUNTDOWN",
      })
    ).toBe(false);
  });

  it("makes ranked 1v1 disconnect behavior explicit", () => {
    expect(getDisconnectForfeitPolicy({ roomCode: null, participantCount: 2 })).toBe("grace_resume");
    expect(getDisconnectForfeitPolicy({ roomCode: "ROOM1", participantCount: 2 })).toBe("none");
    expect(getDisconnectForfeitPolicy({ roomCode: null, participantCount: 3 })).toBe("none");
  });

  it("identifies stale countdown and live matches for abort cleanup", () => {
    expect(
      getStaleMatchAbortReason({
        state: "countdown",
        stateAgeMs: 121_000,
        maxCountdownAgeMs: 120_000,
        maxLiveAgeMs: 1_800_000,
      })
    ).toBe("stale_countdown");

    expect(
      getStaleMatchAbortReason({
        state: "live",
        stateAgeMs: 1_800_001,
        maxCountdownAgeMs: 120_000,
        maxLiveAgeMs: 1_800_000,
      })
    ).toBe("stale_live");

    expect(
      getStaleMatchAbortReason({
        state: "finished",
        stateAgeMs: 999_999,
        maxCountdownAgeMs: 120_000,
        maxLiveAgeMs: 1_800_000,
      })
    ).toBeNull();

    expect(
      getStaleMatchAbortReason({
        state: "waiting_for_both",
        stateAgeMs: 999_999,
        maxCountdownAgeMs: 120_000,
        maxLiveAgeMs: 1_800_000,
      })
    ).toBeNull();

    expect(
      getStaleMatchAbortReason({
        state: "lobby",
        stateAgeMs: 999_999,
        maxCountdownAgeMs: 120_000,
        maxLiveAgeMs: 1_800_000,
      })
    ).toBeNull();
  });
});