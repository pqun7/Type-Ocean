/** @jest-environment node */

import { getPvpSelfCacheKey, readCachedPvpSelf, writeCachedPvpSelf } from "@/features/pvp/server/pvp-self-cache";

class FakeRedis {
  private strings = new Map<string, string>();

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
}

describe("pvp self cache", () => {
  it("round-trips cached /api/pvp/me payloads", async () => {
    const redis = new FakeRedis();

    await writeCachedPvpSelf(
      "user-1",
      {
        rating: 1520,
        deviation: 210,
        gamesPlayed: 14,
        updatedAt: "2026-03-08T10:00:00.000Z",
        rank: { tier: "Gold" },
        classified: true,
        currentStreak: 3,
        level: 5,
      },
      redis
    );

    expect(getPvpSelfCacheKey("user-1")).toBe("pvp:self:user-1");
    await expect(readCachedPvpSelf("user-1", redis)).resolves.toEqual({
      rating: 1520,
      deviation: 210,
      gamesPlayed: 14,
      updatedAt: "2026-03-08T10:00:00.000Z",
      rank: { tier: "Gold" },
      classified: true,
      currentStreak: 3,
      level: 5,
    });
  });
});
