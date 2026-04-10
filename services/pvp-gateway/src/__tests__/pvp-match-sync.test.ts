/** @jest-environment node */

import { buildMatchStatePayload, buildProgressPayload, bumpMatchRevision, markMatchSnapshotBroadcast, shouldBroadcastPeriodicMatchSnapshot } from "../match-sync";
import type { MatchState } from "../state";

function createMatch(): MatchState {
  return {
    matchId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    roomCode: null,
    state: "countdown",
    stateChangedAt: 500,
    revision: 1,
    lastSnapshotBroadcastAtMs: 0,
    status: "COUNTDOWN",
    textSnapshot: "hello world",
    textId: null,
    inputNonce: null,
    serverStartAtMs: 1_000,
    participants: new Map([
      [
        "b",
        {
          userId: "b",
          username: "user-2",
          avatar: null,
          slot: 2,
          input: "",
          seq: 0,
          errors: 0,
          wpm: 0,
          accuracy: 100,
          finishedAt: null,
        },
      ],
      [
        "a",
        {
          userId: "a",
          username: "user-1",
          avatar: null,
          slot: 1,
          input: "",
          seq: 0,
          errors: 0,
          wpm: 0,
          accuracy: 100,
          finishedAt: null,
        },
      ],
    ]),
    endedReason: null,
    forfeitedUserId: null,
    tieWindowStartedAt: null,
    isLowConfidence: false,
  };
}

describe("match sync helpers", () => {
  it("builds stable match snapshots with revisioned player data", () => {
    const match = createMatch();

    const a = match.participants.get("a")!;
    a.input = "hello";
    a.wpm = 84;
    a.accuracy = 98.5;
    a.errors = 1;
    a.finishedAt = 3_000;
    bumpMatchRevision(match);

    const payload = buildMatchStatePayload(match, 4_000);

    expect(payload.revision).toBe(2);
    expect(payload.snapshotAt).toBe(new Date(4_000).toISOString());
    expect(payload.players.map((player) => player.userId)).toEqual(["a", "b"]);
    expect(payload.players[0]).toMatchObject({
      userId: "a",
      caretIndex: 5,
      wpm: 84,
      accuracy: 98.5,
      errors: 1,
      finishedAt: new Date(3_000).toISOString(),
    });
  });

  it("exposes revisioned progress payloads and periodic snapshot gating", () => {
    const match = createMatch();
    match.matchId = "3fa85f64-5717-4562-b3fc-2c963f66afa7";
    match.textSnapshot = "phase three";
    match.participants = new Map([
      [
        "u1",
        {
          userId: "u1",
          username: "user-1",
          avatar: null,
          slot: 1,
          input: "",
          seq: 0,
          errors: 0,
          wpm: 0,
          accuracy: 100,
          finishedAt: null,
        },
      ],
      [
        "u2",
        {
          userId: "u2",
          username: "user-2",
          avatar: null,
          slot: 2,
          input: "",
          seq: 0,
          errors: 0,
          wpm: 0,
          accuracy: 100,
          finishedAt: null,
        },
      ],
    ]);

    const participant = match.participants.get("u1")!;
    participant.input = "pha";
    participant.wpm = 72;
    participant.accuracy = 100;
    participant.errors = 0;

    bumpMatchRevision(match);
    const payload = buildProgressPayload(match, participant, 2_500);

    expect(payload).toMatchObject({
      matchId: match.matchId,
      revision: 2,
      status: "COUNTDOWN",
      userId: "u1",
      caretIndex: 3,
      wpm: 72,
    });

    expect(shouldBroadcastPeriodicMatchSnapshot(match, 2_500, 2_000)).toBe(true);
    markMatchSnapshotBroadcast(match, 2_500);
    expect(shouldBroadcastPeriodicMatchSnapshot(match, 4_000, 2_000)).toBe(false);
    expect(shouldBroadcastPeriodicMatchSnapshot(match, 4_500, 2_000)).toBe(true);

    match.state = "finished";
    match.status = "FINISHED";
    expect(shouldBroadcastPeriodicMatchSnapshot(match, 7_000, 2_000)).toBe(false);
  });
});
