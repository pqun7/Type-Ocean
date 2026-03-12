/** @jest-environment node */

import { buildDisconnectForfeitOutcome } from "../../services/pvp-gateway/src/disconnect-forfeit";
import type { MatchState } from "../../services/pvp-gateway/src/state";

function createMatchState(participantCount: number): MatchState {
  const participants = new Map<string, MatchState["participants"] extends Map<string, infer T> ? T : never>();
  for (let index = 0; index < participantCount; index += 1) {
    participants.set(`u${index + 1}`, {
      userId: `u${index + 1}`,
      username: `User ${index + 1}`,
      avatar: null,
      slot: index,
      input: "abc",
      seq: 1,
      errors: 0,
      wpm: 80 - index,
      accuracy: 98,
      finishedAt: null,
      lastInputAtMs: 0,
      lastInputLen: 0,
      strikes: 0,
    });
  }

  return {
    matchId: "match-1",
    roomCode: null,
    state: "live",
    stateChangedAt: 100,
    status: "RUNNING",
    textSnapshot: "sample",
    serverStartAtMs: 1_000,
    participants,
    endedReason: null,
    forfeitedUserId: null,
    revision: 1,
    lastSnapshotBroadcastAtMs: 0,
  };
}

describe("disconnect forfeit outcome", () => {
  it("creates a strict 2-player forfeit result", () => {
    const match = createMatchState(2);
    const outcome = buildDisconnectForfeitOutcome({
      match,
      forfeitedUserId: "u1",
      nowMs: 5_000,
    });

    expect(outcome).not.toBeNull();
    expect(outcome?.winner.userId).toBe("u2");
    expect(outcome?.loser.userId).toBe("u1");
    expect(outcome?.placements[0]?.userId).toBe("u2");
    expect(outcome?.message.reason).toBe("opponent_disconnected");
  });

  it("does not apply the strict 2-player forfeit helper to multiplayer matches", () => {
    const match = createMatchState(3);
    const outcome = buildDisconnectForfeitOutcome({
      match,
      forfeitedUserId: "u1",
      nowMs: 5_000,
    });

    expect(outcome).toBeNull();
  });
});