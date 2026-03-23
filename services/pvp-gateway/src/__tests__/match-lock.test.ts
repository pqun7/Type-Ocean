/**
 * @file match-lock.test.ts
 *
 * Unit tests for MatchLockRegistry — the FIFO per-match exclusive lock (P4).
 *
 * Tests verify:
 * 1. A second concurrent `withLock` call on the same matchId waits for the first.
 * 2. Three concurrent calls for the same matchId execute in FIFO submission order.
 * 3. When `fn` throws, the lock is released and the next waiter proceeds.
 * 4. Concurrent `withLock` calls for **different** matchIds run in parallel.
 * 5. `dispose()` cleans up the internal state and drains any queued waiters.
 */

import { MatchLockRegistry } from "../domain/match/match-lock";
import type { MatchId } from "../shared/branded-ids";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a branded MatchId without importing the gateway runtime. */
function mid(id: string): MatchId {
  return id as MatchId;
}

/** Returns a promise that resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MatchLockRegistry", () => {
  let registry: MatchLockRegistry;

  beforeEach(() => {
    registry = new MatchLockRegistry();
  });

  // ------------------------------------------------------------------ test 1
  it("serialises two concurrent withLock calls on the same matchId", async () => {
    const matchId = mid("match-1");
    const log: string[] = [];

    const p1 = registry.withLock(matchId, async () => {
      log.push("A:start");
      await delay(20);
      log.push("A:end");
    });

    const p2 = registry.withLock(matchId, async () => {
      log.push("B:start");
      await delay(5);
      log.push("B:end");
    });

    await Promise.all([p1, p2]);

    expect(log).toEqual(["A:start", "A:end", "B:start", "B:end"]);
  });

  // ------------------------------------------------------------------ test 2
  it("executes three concurrent calls in FIFO order", async () => {
    const matchId = mid("match-2");
    const log: string[] = [];

    const p1 = registry.withLock(matchId, async () => {
      log.push("1");
      await delay(20);
    });
    const p2 = registry.withLock(matchId, async () => {
      log.push("2");
      await delay(10);
    });
    const p3 = registry.withLock(matchId, async () => {
      log.push("3");
    });

    await Promise.all([p1, p2, p3]);

    expect(log).toEqual(["1", "2", "3"]);
  });

  // ------------------------------------------------------------------ test 3
  it("releases the lock when fn throws, allowing the next waiter to proceed", async () => {
    const matchId = mid("match-3");
    const log: string[] = [];

    const p1 = registry.withLock(matchId, async () => {
      log.push("A:start");
      await delay(5);
      throw new Error("boom");
    });

    const p2 = registry.withLock(matchId, async () => {
      log.push("B:start");
    });

    // p1 should reject; p2 should still resolve.
    await expect(p1).rejects.toThrow("boom");
    await expect(p2).resolves.toBeUndefined();

    expect(log).toEqual(["A:start", "B:start"]);
  });

  // ------------------------------------------------------------------ test 4
  it("runs concurrent calls on different matchIds in parallel", async () => {
    const mid1 = mid("match-4a");
    const mid2 = mid("match-4b");
    const log: string[] = [];
    let maxConcurrency = 0;
    let currentConcurrency = 0;

    const track = async (name: string) => {
      currentConcurrency++;
      maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
      log.push(`${name}:start`);
      await delay(30);
      log.push(`${name}:end`);
      currentConcurrency--;
    };

    await Promise.all([
      registry.withLock(mid1, () => track("A")),
      registry.withLock(mid2, () => track("B")),
    ]);

    // Both should have been running simultaneously.
    expect(maxConcurrency).toBe(2);
    // Both should finish; order is non-deterministic across IDs.
    expect(log).toContain("A:start");
    expect(log).toContain("B:start");
  });

  // ------------------------------------------------------------------ test 5
  it("dispose removes the internal entry and drains queued waiters", async () => {
    const matchId = mid("match-5");
    const log: string[] = [];

    // Hold the lock.
    let releaseA!: () => void;
    const lockHeld = new Promise<void>((resolve) => { releaseA = resolve; });

    const p1 = registry.withLock(matchId, async () => {
      log.push("A:holding");
      await lockHeld;
      log.push("A:done");
    });

    // Queue a waiter.
    const p2 = registry.withLock(matchId, async () => {
      // match will be gone — in real code this returns early via guard.
      log.push("B:ran-after-dispose");
    });

    // Dispose while lock is held (and waiter is queued).
    registry.dispose(matchId);

    // Release A's hold AFTER dispose — A's finally will try to release a
    // deleted entry, which is a no-op.
    releaseA();

    await Promise.all([p1, p2]);

    // The waiter was drained (its promise resolved) during dispose.
    expect(log).toContain("B:ran-after-dispose");
    // After dispose + drain there should be no lingering internal state.
    // Calling dispose again must be safe (idempotent).
    expect(() => registry.dispose(matchId)).not.toThrow();
  });

  // ------------------------------------------------------------------ test 6
  it("lock entry is cleaned up after all waiters drain (no indefinite accumulation)", async () => {
    const matchId = mid("match-6");

    await registry.withLock(matchId, async () => {
      // no-op
    });

    // After the lock is released with no waiters left, the entry should be
    // gone from internal state.  We verify indirectly: a subsequent withLock
    // call should complete without issues.
    await expect(
      registry.withLock(matchId, async () => "ok"),
    ).resolves.toBe("ok");
  });
});
