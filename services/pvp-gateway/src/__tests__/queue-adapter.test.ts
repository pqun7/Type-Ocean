/**
 * Tests for IQueueAdapter implementations (P10)
 *
 * Verifies that:
 * - `RedisQueueAdapter` delegates each method to the injected closures
 * - `LocalMemoryQueueAdapter` returns safe no-op defaults
 * - Both implementations satisfy the `IQueueAdapter` interface contract
 */

import {
  RedisQueueAdapter,
  LocalMemoryQueueAdapter,
  type IQueueAdapter,
} from "../matchmaking/queue-adapter";
import type { ConnectionUser } from "../state";
import type { QueuedUserMeta } from "../shared/types";

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeUser(overrides?: Partial<ConnectionUser>): ConnectionUser {
  return {
    userId: "u1",
    username: "Alice",
    avatar: null,
    pvpRating: 1000,
    pvpDeviation: 150,
    matchmakingPreference: { mode: "ranked", textDifficulty: "medium" },
    ...overrides,
  };
}

function makeMeta(): QueuedUserMeta {
  return {
    bucketKey: "pvp:queue:ranked:ranked:medium",
    joinedAtMs: Date.now(),
    preference: { mode: "ranked", textDifficulty: "medium" },
    rating: 1000,
  };
}

// ---------------------------------------------------------------------------
// LocalMemoryQueueAdapter
// ---------------------------------------------------------------------------

describe("LocalMemoryQueueAdapter", () => {
  let adapter: IQueueAdapter;

  beforeEach(() => {
    adapter = new LocalMemoryQueueAdapter();
  });

  it("join() returns null", async () => {
    await expect(adapter.join(makeUser())).resolves.toBeNull();
  });

  it("leave() returns 0", async () => {
    await expect(adapter.leave("u1")).resolves.toBe(0);
  });

  it("readMeta() returns null", async () => {
    await expect(adapter.readMeta("u1")).resolves.toBeNull();
  });

  it("tryMatch() returns null", async () => {
    await expect(adapter.tryMatch(makeUser())).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RedisQueueAdapter — delegation
// ---------------------------------------------------------------------------

describe("RedisQueueAdapter", () => {
  function buildRedisMocks() {
    const meta = makeMeta();
    return {
      queueJoin: jest.fn().mockResolvedValue(meta),
      queueLeave: jest.fn().mockResolvedValue(1),
      readQueueMeta: jest.fn().mockResolvedValue(meta),
      tryMatchQueuedUser: jest.fn().mockResolvedValue({
        otherId: "u2",
        me: meta,
        other: makeMeta(),
      }),
    };
  }

  it("join() calls queueJoin with the user and returns its result", async () => {
    const fns = buildRedisMocks();
    const adapter = new RedisQueueAdapter(fns);
    const user = makeUser();
    const result = await adapter.join(user);
    expect(fns.queueJoin).toHaveBeenCalledWith(user);
    expect(result).toMatchObject({
      bucketKey: "pvp:queue:ranked:ranked:medium",
      preference: { mode: "ranked", textDifficulty: "medium" },
      rating: 1000,
      joinedAtMs: expect.any(Number),
    });
  });

  it("leave() calls queueLeave with the userId and returns its result", async () => {
    const fns = buildRedisMocks();
    const adapter = new RedisQueueAdapter(fns);
    const result = await adapter.leave("u1");
    expect(fns.queueLeave).toHaveBeenCalledWith("u1");
    expect(result).toBe(1);
  });

  it("readMeta() calls readQueueMeta with the userId and returns its result", async () => {
    const fns = buildRedisMocks();
    const adapter = new RedisQueueAdapter(fns);
    const result = await adapter.readMeta("u1");
    expect(fns.readQueueMeta).toHaveBeenCalledWith("u1");
    expect(result).toMatchObject({
      bucketKey: "pvp:queue:ranked:ranked:medium",
      preference: { mode: "ranked", textDifficulty: "medium" },
      rating: 1000,
      joinedAtMs: expect.any(Number),
    });
  });

  it("tryMatch() calls tryMatchQueuedUser with the user and returns its result", async () => {
    const fns = buildRedisMocks();
    const adapter = new RedisQueueAdapter(fns);
    const user = makeUser();
    const result = await adapter.tryMatch(user);
    expect(fns.tryMatchQueuedUser).toHaveBeenCalledWith(user);
    expect(result).not.toBeNull();
    expect(result?.otherId).toBe("u2");
  });

  it("join() propagates nulls from the underlying function", async () => {
    const fns = buildRedisMocks();
    fns.queueJoin.mockResolvedValue(null);
    const adapter = new RedisQueueAdapter(fns);
    await expect(adapter.join(makeUser())).resolves.toBeNull();
  });

  it("leave() returns 0 when the underlying function returns 0", async () => {
    const fns = buildRedisMocks();
    fns.queueLeave.mockResolvedValue(0);
    const adapter = new RedisQueueAdapter(fns);
    await expect(adapter.leave("u99")).resolves.toBe(0);
  });

  it("tryMatch() returns null when no match is found", async () => {
    const fns = buildRedisMocks();
    fns.tryMatchQueuedUser.mockResolvedValue(null);
    const adapter = new RedisQueueAdapter(fns);
    await expect(adapter.tryMatch(makeUser())).resolves.toBeNull();
  });

  it("propagates errors thrown by the underlying functions", async () => {
    const fns = buildRedisMocks();
    fns.queueLeave.mockRejectedValue(new Error("Redis connection lost"));
    const adapter = new RedisQueueAdapter(fns);
    await expect(adapter.leave("u1")).rejects.toThrow("Redis connection lost");
  });
});

// ---------------------------------------------------------------------------
// Interface contract: LocalMemoryQueueAdapter is-a IQueueAdapter
// ---------------------------------------------------------------------------

describe("IQueueAdapter interface contract", () => {
  const implementations: Array<[string, () => IQueueAdapter]> = [
    ["LocalMemoryQueueAdapter", () => new LocalMemoryQueueAdapter()],
    [
      "RedisQueueAdapter",
      () =>
        new RedisQueueAdapter({
          queueJoin: jest.fn().mockResolvedValue(null),
          queueLeave: jest.fn().mockResolvedValue(0),
          readQueueMeta: jest.fn().mockResolvedValue(null),
          tryMatchQueuedUser: jest.fn().mockResolvedValue(null),
        }),
    ],
  ];

  test.each(implementations)(
    "%s: join/leave/readMeta/tryMatch all return Promises",
    async (_name, factory) => {
      const adapter = factory();
      const user = makeUser();
      expect(adapter.join(user)).toBeInstanceOf(Promise);
      expect(adapter.leave("u1")).toBeInstanceOf(Promise);
      expect(adapter.readMeta("u1")).toBeInstanceOf(Promise);
      expect(adapter.tryMatch(user)).toBeInstanceOf(Promise);
    },
  );
});
