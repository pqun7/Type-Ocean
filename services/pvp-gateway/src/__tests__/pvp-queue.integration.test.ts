/** @jest-environment node */

import { enqueueOrMatchInMemory } from "../in-memory-queue";
import { createLocalLock } from "../local-lock";
import type { ConnectionUser, QueueEntry } from "../state";

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

describe("in-memory queue integration", () => {
  it("matches exactly one pair under concurrent queue joins", async () => {
    const lock = createLocalLock();
    const queue: QueueEntry[] = [];
    const matches: Array<[string, string]> = [];

    await Promise.all(
      [createUser("u1", 1500), createUser("u2", 1510)].map((user) =>
        lock.runExclusive(async () => {
          const result = enqueueOrMatchInMemory({
            queue,
            user,
            ratingRange: 200,
            nowMs: 1_000,
          });

          if (result.kind === "matched") {
            matches.push([result.users[0].userId, result.users[1].userId]);
          }
        })
      )
    );

    expect(matches).toHaveLength(1);
    expect(queue).toHaveLength(0);
    expect(matches[0]?.sort()).toEqual(["u1", "u2"]);
  });

  it("keeps the latest queue metadata for duplicate joins", () => {
    const queue: QueueEntry[] = [];
    const user = createUser("u1", 1500);

    const first = enqueueOrMatchInMemory({
      queue,
      user,
      ratingRange: 200,
      nowMs: 1_000,
      requestId: "req-first",
      connectionId: "conn-first",
    });

    const second = enqueueOrMatchInMemory({
      queue,
      user,
      ratingRange: 200,
      nowMs: 1_100,
      requestId: "req-second",
      connectionId: "conn-second",
    });

    expect(first.kind).toBe("searching");
    expect(second.kind).toBe("searching");
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      joinedAtMs: 1_100,
      requestId: "req-second",
      connectionId: "conn-second",
    });
  });

  it("does not match users with incompatible queue modes", () => {
    const queue: QueueEntry[] = [];

    const rankedJoin = enqueueOrMatchInMemory({
      queue,
      user: createUser("u1", 1500, { mode: "ranked_1v1" }),
      ratingRange: 200,
      nowMs: 1_000,
    });

    const casualJoin = enqueueOrMatchInMemory({
      queue,
      user: createUser("u2", 1505, { mode: "casual_1v1" }),
      ratingRange: 200,
      nowMs: 1_100,
    });

    expect(rankedJoin.kind).toBe("searching");
    expect(casualJoin.kind).toBe("searching");
    expect(queue).toHaveLength(2);
  });

  it("keeps searching when rating gap exceeds current range", () => {
    const queue: QueueEntry[] = [];

    const first = enqueueOrMatchInMemory({
      queue,
      user: createUser("u1", 1500),
      ratingRange: 50,
      nowMs: 1_000,
    });

    const second = enqueueOrMatchInMemory({
      queue,
      user: createUser("u2", 1620),
      ratingRange: 50,
      nowMs: 1_000,
    });

    expect(first.kind).toBe("searching");
    expect(second.kind).toBe("searching");
    expect(queue).toHaveLength(2);
  });

  it("matches after queue band expansion for a long-waiting user", () => {
    const queue: QueueEntry[] = [];

    const first = enqueueOrMatchInMemory({
      queue,
      user: createUser("u1", 1500),
      ratingRange: 50,
      nowMs: 0,
    });

    const second = enqueueOrMatchInMemory({
      queue,
      user: createUser("u2", 1620),
      ratingRange: 50,
      nowMs: 20_000,
    });

    expect(first.kind).toBe("searching");
    expect(second.kind).toBe("matched");

    if (second.kind === "matched") {
      expect(second.users.map((u) => u.userId).sort()).toEqual(["u1", "u2"]);
      expect(second.queueWaitMs).toEqual([20_000, 0]);
    }
    expect(queue).toHaveLength(0);
  });

  it("keeps only one queue entry for repeated joins by the same user", () => {
    const queue: QueueEntry[] = [];
    const user = createUser("u1", 1500);

    enqueueOrMatchInMemory({
      queue,
      user,
      ratingRange: 200,
      nowMs: 5_000,
      requestId: "first",
      connectionId: "conn-a",
    });

    enqueueOrMatchInMemory({
      queue,
      user,
      ratingRange: 200,
      nowMs: 5_500,
      requestId: "second",
      connectionId: "conn-b",
    });

    enqueueOrMatchInMemory({
      queue,
      user,
      ratingRange: 200,
      nowMs: 6_000,
      requestId: "third",
      connectionId: "conn-c",
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      joinedAtMs: 6_000,
      requestId: "third",
      connectionId: "conn-c",
    });
  });

  it("matches against the earliest compatible queued opponent", () => {
    const queue: QueueEntry[] = [];

    enqueueOrMatchInMemory({
      queue,
      user: createUser("u1", 1500),
      ratingRange: 100,
      nowMs: 1_000,
    });

    enqueueOrMatchInMemory({
      queue,
      user: createUser("u2", 1700),
      ratingRange: 100,
      nowMs: 1_100,
    });

    const result = enqueueOrMatchInMemory({
      queue,
      user: createUser("u3", 1510),
      ratingRange: 100,
      nowMs: 1_200,
    });

    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.users.map((u) => u.userId).sort()).toEqual(["u1", "u3"]);
      expect(result.queueWaitMs).toEqual([200, 0]);
    }
    expect(queue).toHaveLength(1);
    expect(queue[0]?.user.userId).toBe("u2");
  });
});