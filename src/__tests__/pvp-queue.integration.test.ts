/** @jest-environment node */

import { enqueueOrMatchInMemory } from "../../services/pvp-gateway/src/in-memory-queue";
import { createLocalLock } from "../../services/pvp-gateway/src/local-lock";
import type { ConnectionUser, QueueEntry } from "../../services/pvp-gateway/src/state";

function createUser(userId: string, pvpRating: number): ConnectionUser {
  return {
    userId,
    username: userId,
    avatar: null,
    pvpRating,
    pvpDeviation: 350,
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
});