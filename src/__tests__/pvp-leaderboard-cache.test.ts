/** @jest-environment node */

import { buildLeaderboardScore, primeLeaderboardPageCache, readLeaderboardPageFromCache } from "../features/pvp/server/leaderboard-cache";

class FakeRedis {
  private strings = new Map<string, string>();
  private sortedSets = new Map<string, Map<string, number>>();

  async get(key: string) {
    return this.strings.get(key) ?? null;
  }

  async setex(key: string, _seconds: number, value: string) {
    this.strings.set(key, value);
    return "OK";
  }

  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) {
      removed += this.strings.delete(key) ? 1 : 0;
    }
    return removed;
  }

  async zadd(key: string, score: number, member: string) {
    const set = this.sortedSets.get(key) ?? new Map<string, number>();
    set.set(member, score);
    this.sortedSets.set(key, set);
    return 1;
  }

  async zrem(key: string, member: string) {
    const set = this.sortedSets.get(key);
    if (!set) return 0;
    return set.delete(member) ? 1 : 0;
  }

  async zcard(key: string) {
    return this.sortedSets.get(key)?.size ?? 0;
  }

  async zrevrange(key: string, start: number, stop: number) {
    const set = this.sortedSets.get(key);
    if (!set) return [];

    return Array.from(set.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(start, stop + 1)
      .map(([member]) => member);
  }
}

describe("pvp leaderboard cache", () => {
  it("builds higher scores for newer equally-rated players", () => {
    const older = buildLeaderboardScore(1500, new Date("2026-03-08T10:00:00.000Z").getTime());
    const newer = buildLeaderboardScore(1500, new Date("2026-03-08T10:01:00.000Z").getTime());

    expect(newer).toBeGreaterThan(older);
  });

  it("hydrates a cached leaderboard page from redis zset plus entry payloads", async () => {
    const redis = new FakeRedis();

    await primeLeaderboardPageCache({
      totalRanked: 3,
      profiles: [
        {
          userId: "u1",
          username: "Alpha",
          avatar: null,
          rating: 1700,
          ratingUpdatedAt: new Date("2026-03-08T10:05:00.000Z"),
          updatedAt: new Date("2026-03-08T10:05:00.000Z"),
        },
        {
          userId: "u2",
          username: "Bravo",
          avatar: null,
          rating: 1650,
          ratingUpdatedAt: new Date("2026-03-08T10:04:00.000Z"),
          updatedAt: new Date("2026-03-08T10:04:00.000Z"),
        },
        {
          userId: "u3",
          username: "Charlie",
          avatar: null,
          rating: 1600,
          ratingUpdatedAt: new Date("2026-03-08T10:03:00.000Z"),
          updatedAt: new Date("2026-03-08T10:03:00.000Z"),
        },
      ],
      redisClient: redis,
    });

    const page = await readLeaderboardPageFromCache({
      limit: 2,
      offset: 0,
      redisClient: redis,
    });

    expect(page).toMatchObject({
      totalRanked: 3,
      cutoff: 1,
    });
    expect(page?.entries.map((entry) => entry.userId)).toEqual(["u1", "u2"]);
    expect(page?.entries[0]).toMatchObject({ position: 1, username: "Alpha", classified: true });
    expect(page?.entries[1]).toMatchObject({ position: 2, username: "Bravo", classified: false });
  });
});
