/** @jest-environment node */

import { canJoinPvpMatchSocket, canOpenPvpMatchPage, isTerminalPvpMatchStatus } from "../features/pvp/server/match-access";

describe("pvp match access guards", () => {
  it("blocks non-participants from opening or joining matches", () => {
    expect(canOpenPvpMatchPage({ status: "RUNNING", participantExists: false })).toBe(false);
    expect(
      canJoinPvpMatchSocket({
        status: "RUNNING",
        participantExists: false,
        userId: "u1",
      })
    ).toEqual({ allowed: false, reason: "not_participant" });
  });

  it("blocks terminal matches from being reopened or rejoined", () => {
    expect(isTerminalPvpMatchStatus("FINISHED")).toBe(true);
    expect(canOpenPvpMatchPage({ status: "FINISHED", participantExists: true })).toBe(false);
    expect(
      canJoinPvpMatchSocket({
        status: "ABORTED",
        participantExists: true,
        userId: "u1",
      })
    ).toEqual({ allowed: false, reason: "match_closed" });
  });

  it("blocks reconnect after disconnect forfeit for the forfeiting player", () => {
    expect(
      canJoinPvpMatchSocket({
        status: "RUNNING",
        participantExists: true,
        userId: "u1",
        forfeitedUserId: "u1",
        endedReason: "opponent_disconnected",
      })
    ).toEqual({ allowed: false, reason: "disconnect_forfeit" });
  });

  it("allows active participants to open and join live matches", () => {
    expect(canOpenPvpMatchPage({ status: "COUNTDOWN", participantExists: true })).toBe(true);
    expect(
      canJoinPvpMatchSocket({
        status: "RUNNING",
        participantExists: true,
        userId: "u1",
      })
    ).toEqual({ allowed: true });
  });
});