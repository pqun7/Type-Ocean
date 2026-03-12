/** @jest-environment node */

import {
  __leaderboardTestUtils,
  readLeaderboardPageFromCache,
} from "../features/pvp/server/leaderboard-cache";

class FakeRedis {
  private strings = new Map<string, string>();

  async get(key: string) {
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.strings.set(key, value);
    return "OK";
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

  async incr(key: string) {
    const current = Number(this.strings.get(key) ?? "0");
    const next = current + 1;
    this.strings.set(key, String(next));
    return next;
  }
}

describe("pvp leaderboard cache", () => {
  it("builds classified entries from ordered rows", () => {
    const result = __leaderboardTestUtils.buildLeaderboardPageResult({
      limit: 2,
      offset: 0,
      totalRanked: 3,
      rows: [
        {
          position: 1,
          userId: "u1",
          username: "Alpha",
          avatar: null,
          rating: 1700,
          updatedAt: new Date("2026-03-08T10:05:00.000Z"),
        },
        {
          position: 2,
          userId: "u2",
          username: "Bravo",
          avatar: null,
          rating: 1650,
          updatedAt: new Date("2026-03-08T10:04:00.000Z"),
        },
      ],
    });

    expect(result.totalRanked).toBe(3);
    expect(result.cutoff).toBe(1);
    expect(result.entries[0]).toMatchObject({ position: 1, username: "Alpha", classified: true });
    expect(result.entries[1]).toMatchObject({ position: 2, username: "Bravo", classified: false });
  });

  it("hydrates a cached leaderboard page by versioned page key", async () => {
    const redis = new FakeRedis();
    const cacheKey = __leaderboardTestUtils.getLeaderboardPageCacheKey(2, 0, 4);

    await redis.set(cacheKey, JSON.stringify({
      v: 2,
      result: {
        limit: 2,
        offset: 0,
        totalRanked: 3,
        cutoff: 1,
        entries: [
          {
            position: 1,
            userId: "u1",
            username: "Alpha",
            avatar: null,
            rating: 1700,
            tier: "Platinum",
            updatedAt: "2026-03-08T10:05:00.000Z",
            classified: true,
          },
        ],
      },
    }));

    const page = await readLeaderboardPageFromCache({
      limit: 2,
      offset: 0,
      redisClient: redis,
      cacheVersion: 4,
    });

    expect(page).toEqual({
      limit: 2,
      offset: 0,
      totalRanked: 3,
      cutoff: 1,
      entries: [
        {
          position: 1,
          userId: "u1",
          username: "Alpha",
          avatar: null,
          rating: 1700,
          tier: "Platinum",
          updatedAt: "2026-03-08T10:05:00.000Z",
          classified: true,
        },
      ],
    });
  });

  it("marks only recent non-stale snapshots as fresh", () => {
    const now = new Date("2026-03-10T10:00:00.000Z").getTime();

    expect(
      __leaderboardTestUtils.isSnapshotFresh(
        {
          rowCount: 25,
          refreshedAt: new Date("2026-03-10T09:59:30.000Z"),
          stale: false,
        },
        now
      )
    ).toBe(true);

    expect(
      __leaderboardTestUtils.isSnapshotFresh(
        {
          rowCount: 25,
          refreshedAt: new Date("2026-03-10T09:58:00.000Z"),
          stale: false,
        },
        now
      )
    ).toBe(false);

    expect(
      __leaderboardTestUtils.isSnapshotFresh(
        {
          rowCount: 25,
          refreshedAt: new Date("2026-03-10T09:59:30.000Z"),
          stale: true,
        },
        now
      )
    ).toBe(false);
  });
});
