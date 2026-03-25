/** @jest-environment node */

import { buildDisconnectForfeitOutcome, runDisconnectForfeitSequence } from "../disconnect-forfeit";
import { shouldActivateCountdownMatch } from "../application/match-start";
import { enqueueOrMatchInMemory } from "../in-memory-queue";
import {
  matchStateFromDbStatus,
  matchStateToDbStatus,
  transitionMatchState,
} from "../match-fsm";
import {
  getDisconnectForfeitPolicy,
  getStaleMatchAbortReason,
  shouldDeferDisconnectForfeitForJoin,
  shouldScheduleDisconnectForfeit,
} from "../match-session-guards";
import { canJoinPvpMatchSocket, canOpenPvpMatchPage } from "@/features/pvp/server/match-access";
import { getPublicRoomStartCondition, selectNextRoomHost } from "../rooms/lifecycle";
import type { ConnectionUser, MatchState, QueueEntry } from "../state";
import { MatchJoinMessageSchema, RoomJoinMessageSchema } from "@/lib/validation/ws-schemas";
import { sanitizeRoomCode } from "@/lib/sanitize";

function createUser(
  userId: string,
  pvpRating: number,
  preference?: Partial<NonNullable<ConnectionUser["matchmakingPreference"]>>
): ConnectionUser {
  return {
    userId,
    username: userId,
    avatar: null,
    pvpRating,
    pvpDeviation: 350,
    matchmakingPreference: {
      mode: preference?.mode ?? "ranked_1v1",
      textDifficulty: preference?.textDifficulty ?? "normal",
    },
  };
}

function createLiveMatchState(matchId: string): MatchState {
  return {
    matchId,
    roomCode: null,
    state: "live",
    stateChangedAt: 100,
    status: "RUNNING",
    textSnapshot: "sample",
    textId: null,
    inputNonce: null,
    serverStartAtMs: 1_000,
    participants: new Map([
      [
        "u1",
        {
          userId: "u1",
          username: "User 1",
          avatar: null,
          slot: 0,
          input: "abc",
          seq: 1,
          errors: 0,
          wpm: 80,
          accuracy: 98,
          finishedAt: null,
          lastInputAtMs: 0,
          lastInputLen: 0,
          strikes: 0,
        },
      ],
      [
        "u2",
        {
          userId: "u2",
          username: "User 2",
          avatar: null,
          slot: 1,
          input: "abc",
          seq: 1,
          errors: 0,
          wpm: 78,
          accuracy: 97,
          finishedAt: null,
          lastInputAtMs: 0,
          lastInputLen: 0,
          strikes: 0,
        },
      ],
    ]),
    endedReason: null,
    forfeitedUserId: null,
    revision: 1,
    lastSnapshotBroadcastAtMs: 0,
    tieWindowStartedAt: null,
  };
}

describe("pvp higher integration flows", () => {
  it("covers ranked 1v1 flow from queue match to disconnect-forfeit scheduling", () => {
    const queue: QueueEntry[] = [];

    enqueueOrMatchInMemory({
      queue,
      user: createUser("u1", 1500),
      ratingRange: 100,
      nowMs: 1_000,
    });

    const matchResult = enqueueOrMatchInMemory({
      queue,
      user: createUser("u2", 1520),
      ratingRange: 100,
      nowMs: 1_100,
    });

    expect(matchResult.kind).toBe("matched");
    expect(queue).toHaveLength(0);

    expect(
      canJoinPvpMatchSocket({
        status: "RUNNING",
        participantExists: true,
        userId: "u1",
      })
    ).toEqual({ allowed: true });

    const policy = getDisconnectForfeitPolicy({ roomCode: null, participantCount: 2 });
    expect(policy).toBe("grace_resume");

    expect(
      shouldScheduleDisconnectForfeit({
        policy,
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: "live",
        matchStatus: "RUNNING",
      })
    ).toBe(true);

    expect(
      shouldScheduleDisconnectForfeit({
        policy,
        participantCount: 2,
        otherActiveSocketsForUser: 1,
        matchState: "live",
        matchStatus: "RUNNING",
      })
    ).toBe(false);
  });

  it("keeps reconnect path safe while join is in-flight then blocks forfeited rejoin", () => {
    expect(shouldDeferDisconnectForfeitForJoin({ joinInFlight: true })).toBe(true);

    expect(
      canJoinPvpMatchSocket({
        status: "RUNNING",
        participantExists: true,
        userId: "u1",
      })
    ).toEqual({ allowed: true });

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

  it("uses room-specific lifecycle rules instead of ranked disconnect forfeit", () => {
    const nextHost = selectNextRoomHost(
      [
        { userId: "host", joinedAt: new Date("2026-03-10T10:00:00.000Z"), readyAt: null, leftAt: new Date("2026-03-10T10:05:00.000Z") },
        { userId: "u2", joinedAt: new Date("2026-03-10T10:01:00.000Z"), readyAt: new Date("2026-03-10T10:04:00.000Z"), leftAt: null },
        { userId: "u3", joinedAt: new Date("2026-03-10T10:02:00.000Z"), readyAt: new Date("2026-03-10T10:04:30.000Z"), leftAt: null },
      ],
      "host"
    );

    expect(nextHost).toBe("u2");

    const roomPolicy = getDisconnectForfeitPolicy({ roomCode: "ABCD", participantCount: 2 });
    expect(roomPolicy).toBe("none");

    expect(
      shouldScheduleDisconnectForfeit({
        policy: roomPolicy,
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: "live",
        matchStatus: "RUNNING",
      })
    ).toBe(false);

    expect(
      getPublicRoomStartCondition({
        members: [
          { readyAt: new Date("2026-03-10T10:04:00.000Z"), leftAt: null },
          { readyAt: new Date("2026-03-10T10:04:30.000Z"), leftAt: null },
        ],
        minimumPlayers: 2,
        maxPlayers: 6,
        autoStartAt: new Date("2026-03-10T10:10:00.000Z"),
        nowMs: Date.parse("2026-03-10T10:05:00.000Z"),
      })
    ).toBe("all_ready");
  });

  it("prevents incompatible queue users from matching and blocks non-participant access", () => {
    const queue: QueueEntry[] = [];

    enqueueOrMatchInMemory({
      queue,
      user: createUser("u1", 1500, { mode: "ranked_1v1" }),
      ratingRange: 200,
      nowMs: 2_000,
    });

    const second = enqueueOrMatchInMemory({
      queue,
      user: createUser("u2", 1501, { mode: "casual_1v1" }),
      ratingRange: 200,
      nowMs: 2_100,
    });

    expect(second.kind).toBe("searching");
    expect(queue).toHaveLength(2);

    expect(
      canJoinPvpMatchSocket({
        status: "RUNNING",
        participantExists: false,
        userId: "u2",
      })
    ).toEqual({ allowed: false, reason: "not_participant" });

    expect(canOpenPvpMatchPage({ status: "RUNNING", participantExists: false })).toBe(false);
  });

  it("keeps disconnect-forfeit sequence order while room start condition prioritizes room_full over timeout", async () => {
    const order: string[] = [];

    await runDisconnectForfeitSequence({
      sendMatchEnded: () => {
        order.push("match-ended");
      },
      finalizeResults: async () => {
        order.push("results");
      },
    });

    expect(order).toEqual(["match-ended", "results"]);

    expect(
      getPublicRoomStartCondition({
        members: [
          { readyAt: new Date("2026-03-10T10:00:00.000Z"), leftAt: null },
          { readyAt: null, leftAt: null },
          { readyAt: null, leftAt: null },
          { readyAt: null, leftAt: null },
        ],
        minimumPlayers: 2,
        maxPlayers: 4,
        autoStartAt: new Date("2026-03-10T10:01:00.000Z"),
        nowMs: Date.parse("2026-03-10T10:02:00.000Z"),
      })
    ).toBe("room_full");
  });

  it("moves ranked match through waiting_for_both to countdown and live after both joins", () => {
    const queue: QueueEntry[] = [];

    enqueueOrMatchInMemory({
      queue,
      user: createUser("u1", 1510),
      ratingRange: 100,
      nowMs: 10_000,
    });

    const result = enqueueOrMatchInMemory({
      queue,
      user: createUser("u2", 1520),
      ratingRange: 100,
      nowMs: 10_050,
    });

    expect(result.kind).toBe("matched");

    let lifecycle = {
      state: matchStateFromDbStatus("PENDING"),
      stateChangedAt: 10_050,
    };

    expect(lifecycle.state).toBe("waiting_for_both");
    lifecycle = transitionMatchState(lifecycle, "countdown", 10_100);
    expect(matchStateToDbStatus(lifecycle.state)).toBe("COUNTDOWN");

    lifecycle = transitionMatchState(lifecycle, "live", 13_100);
    expect(lifecycle.state).toBe("live");
    expect(matchStateToDbStatus(lifecycle.state)).toBe("RUNNING");
  });

  it("covers the ranked happy path from queue match to countdown activation and terminal state", () => {
    const queue: QueueEntry[] = [];

    enqueueOrMatchInMemory({
      queue,
      user: createUser("u1", 1500),
      ratingRange: 100,
      nowMs: 30_000,
    });

    const matchResult = enqueueOrMatchInMemory({
      queue,
      user: createUser("u2", 1508),
      ratingRange: 100,
      nowMs: 30_050,
    });

    expect(matchResult.kind).toBe("matched");

    let lifecycle = {
      state: matchStateFromDbStatus("PENDING"),
      stateChangedAt: 30_050,
    };
    const serverStartAtMs = 33_050;

    expect(lifecycle.state).toBe("waiting_for_both");
    expect(
      shouldScheduleDisconnectForfeit({
        policy: getDisconnectForfeitPolicy({ roomCode: null, participantCount: 2 }),
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: lifecycle.state,
        matchStatus: "PENDING",
      }),
    ).toBe(false);

    lifecycle = transitionMatchState(lifecycle, "countdown", 30_100);
    expect(matchStateToDbStatus(lifecycle.state)).toBe("COUNTDOWN");
    expect(
      shouldActivateCountdownMatch({
        matchState: lifecycle.state,
        nowMs: serverStartAtMs - 1,
        serverStartAtMs,
      }),
    ).toBe(false);
    expect(
      shouldActivateCountdownMatch({
        matchState: lifecycle.state,
        nowMs: serverStartAtMs,
        serverStartAtMs,
      }),
    ).toBe(true);
    expect(
      shouldScheduleDisconnectForfeit({
        policy: getDisconnectForfeitPolicy({ roomCode: null, participantCount: 2 }),
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: lifecycle.state,
        matchStatus: "COUNTDOWN",
      }),
    ).toBe(false);

    lifecycle = transitionMatchState(lifecycle, "live", serverStartAtMs);
    expect(matchStateToDbStatus(lifecycle.state)).toBe("RUNNING");
    expect(
      shouldScheduleDisconnectForfeit({
        policy: getDisconnectForfeitPolicy({ roomCode: null, participantCount: 2 }),
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: lifecycle.state,
        matchStatus: "RUNNING",
      }),
    ).toBe(true);

    const finished = transitionMatchState(lifecycle, "finished", 36_000);
    expect(matchStateToDbStatus(finished.state)).toBe("FINISHED");
    expect(
      canJoinPvpMatchSocket({
        status: "FINISHED",
        participantExists: true,
        userId: "u1",
      }),
    ).toEqual({ allowed: false, reason: "match_closed" });
  });

  it("does not schedule disconnect forfeit during countdown but enables it in live", () => {
    const policy = getDisconnectForfeitPolicy({ roomCode: null, participantCount: 2 });
    expect(policy).toBe("grace_resume");

    expect(
      shouldScheduleDisconnectForfeit({
        policy,
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: "countdown",
        matchStatus: "COUNTDOWN",
      })
    ).toBe(false);

    expect(
      shouldScheduleDisconnectForfeit({
        policy,
        participantCount: 2,
        otherActiveSocketsForUser: 0,
        matchState: "live",
        matchStatus: "RUNNING",
      })
    ).toBe(true);
  });

  it("keeps reconnect window valid in live when join is in-flight then allows join", () => {
    expect(shouldDeferDisconnectForfeitForJoin({ joinInFlight: true })).toBe(true);

    const reconnect = canJoinPvpMatchSocket({
      status: "RUNNING",
      participantExists: true,
      userId: "u1",
    });

    expect(reconnect).toEqual({ allowed: true });
  });

  it("closes access after terminal transition and reports stale guards for old live matches", () => {
    const live = {
      state: "live" as const,
      stateChangedAt: 20_000,
    };

    const finished = transitionMatchState(live, "finished", 25_000);
    expect(matchStateToDbStatus(finished.state)).toBe("FINISHED");

    expect(
      canJoinPvpMatchSocket({
        status: "FINISHED",
        participantExists: true,
        userId: "u1",
      })
    ).toEqual({ allowed: false, reason: "match_closed" });

    expect(canOpenPvpMatchPage({ status: "FINISHED", participantExists: true })).toBe(false);

    expect(
      getStaleMatchAbortReason({
        state: "live",
        stateAgeMs: 1_900_000,
        maxCountdownAgeMs: 120_000,
        maxLiveAgeMs: 1_800_000,
      })
    ).toBe("stale_live");
  });

  it("normalizes ROOM_JOIN code and validates schema", () => {
    const rawCode = " ab-12🙂cd ";
    const normalizedCode = sanitizeRoomCode(rawCode);

    expect(normalizedCode).toBe("AB12CD");

    expect(
      RoomJoinMessageSchema.safeParse({
        type: "ROOM_JOIN",
        requestId: "room_join_123",
        payload: {
          code: normalizedCode,
          language: "en",
        },
      }).success
    ).toBe(true);

    expect(
      RoomJoinMessageSchema.safeParse({
        type: "ROOM_JOIN",
        payload: {
          code: "A-1",
        },
      }).success
    ).toBe(false);
  });

  it("accepts valid MATCH_JOIN and rejects malformed match ids", () => {
    expect(
      MatchJoinMessageSchema.safeParse({
        type: "MATCH_JOIN",
        requestId: "match_join_123",
        payload: {
          matchId: "550e8400-e29b-41d4-a716-446655440000",
          lastSeenRevision: 42,
        },
      }).success
    ).toBe(true);

    expect(
      MatchJoinMessageSchema.safeParse({
        type: "MATCH_JOIN",
        payload: {
          matchId: "not-a-uuid",
          lastSeenRevision: 42,
        },
      }).success
    ).toBe(false);
  });

  it("builds disconnect-forfeit results and runs MATCH_ENDED then RESULTS without errors", async () => {
    const match = createLiveMatchState("match-1");
    const outcome = buildDisconnectForfeitOutcome({
      match,
      forfeitedUserId: "u1",
      nowMs: 5_000,
    });

    expect(outcome).not.toBeNull();
    expect(outcome?.winner.userId).toBe("u2");
    expect(outcome?.placements).toHaveLength(2);

    const order: string[] = [];

    await expect(
      runDisconnectForfeitSequence({
        sendMatchEnded: () => {
          order.push("match-ended");
        },
        finalizeResults: async () => {
          order.push("results");
        },
      })
    ).resolves.toBeUndefined();

    expect(order).toEqual(["match-ended", "results"]);
  });
});
