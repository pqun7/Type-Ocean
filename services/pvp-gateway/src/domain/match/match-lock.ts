/**
 * @module match-lock
 *
 * Zero-dependency, FIFO per-match exclusive lock for the PvP gateway.
 *
 * ## Problem (P4)
 *
 * `index.ts` mutates shared `LocalMatch` objects across multiple async
 * operations (`state.matches.get` → await-heavy work → `state.matches.set/delete`).
 * Concurrent WebSocket messages or timer callbacks for the *same* match can
 * interleave those awaits, producing torn in-memory state and
 * double-finalisation despite the existing `matchFinalizationLocks` Set.
 *
 * ## Solution
 *
 * A `MatchLockRegistry` holds one FIFO promise-queue per `MatchId`.  All
 * mutation paths to a match are wrapped with `registry.withLock(matchId, fn)`.
 * Concurrent calls queue up and execute strictly in submission order — no
 * starvation, no external dependencies, no additional npm packages.
 *
 * ## Usage
 * ```ts
 * const registry = new MatchLockRegistry();
 *
 * // Serialised — second call waits for first to resolve/reject.
 * await Promise.all([
 *   registry.withLock(matchId, mutateA),
 *   registry.withLock(matchId, mutateB),
 * ]);
 *
 * // When the match is removed, free the entry.
 * registry.dispose(matchId);
 * ```
 *
 * ## Deadlock warning
 * Never call `withLock(id, fn)` from *inside* an active `fn` for the **same**
 * `id`.  Doing so deadlocks: the inner call waits forever for the outer to
 * finish, while the outer waits for the inner to resolve.
 *
 * See problem P4 in `problem.md`.
 */

import type { MatchId } from "../../shared/branded-ids";

// =============================================================================
// INTERNALS
// =============================================================================

/**
 * Internal per-match lock entry.
 *
 * `locked` tracks whether the lock is currently held.
 * `queue` is a FIFO list of resolve callbacks — each represents one pending
 * `withLock` call waiting to be granted the lock.
 */
type LockEntry = {
  locked: boolean;
  queue: Array<() => void>;
};

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Per-match FIFO exclusive lock registry.
 *
 * One registry instance is shared for the entire gateway lifetime and is
 * disposed alongside each match via {@link MatchCleanupService}.
 */
export class MatchLockRegistry {
  /** Internal map from `MatchId` to its queue entry. */
  private readonly locks = new Map<MatchId, LockEntry>();

  /**
   * Acquire the exclusive lock for `matchId`, run `fn`, then release it.
   *
   * - Concurrent calls for the **same** `matchId` queue in FIFO order.
   * - Concurrent calls for **different** `matchId`s run in parallel.
   * - The lock is **always** released in the `finally` clause, even if `fn`
   *   throws.
   *
   * @param matchId - The match whose lock to acquire.
   * @param fn      - Async work to run exclusively.
   * @returns The value returned by `fn`.
   * @throws Whatever `fn` throws (lock is released first).
   */
  async withLock<T>(matchId: MatchId, fn: () => Promise<T>): Promise<T> {
    await this.acquire(matchId);
    try {
      return await fn();
    } finally {
      this.release(matchId);
    }
  }

  /**
   * Remove the lock entry for `matchId`, settling any queued waiters.
   *
   * Safe to call even if no entry exists.
   *
   * > **Note**: In normal operation there should be no queued waiters when
   * > `dispose` is called, because cleanup only happens after a match is fully
   * > finalised and its WS session winds down.  If waiters are present (e.g.
   * > during an abnormal shutdown), their promises are resolved immediately so
   * > they can detect the gone-away match via guards (`if (!match) return`).
   *
   * @param matchId - Match whose lock entry should be removed.
   */
  dispose(matchId: MatchId): void {
    const entry = this.locks.get(matchId);
    if (entry) {
      // Drain any queued waiters so their promises resolve.  Each will then
      // hit an early-return guard in the caller (match will be gone).
      for (const resolve of entry.queue) {
        resolve();
      }
    }
    this.locks.delete(matchId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Acquire the lock for `matchId`.
   *
   * Returns a promise that:
   * - resolves **synchronously** (via `Promise.resolve()`) when the lock was
   *   free or had no active holder, or
   * - resolves **asynchronously** once the current holder releases the lock.
   */
  private acquire(matchId: MatchId): Promise<void> {
    const existing = this.locks.get(matchId);

    if (!existing) {
      // First acquisition — create entry and mark locked immediately.
      this.locks.set(matchId, { locked: true, queue: [] });
      return Promise.resolve();
    }

    if (!existing.locked) {
      // Entry exists but no one holds the lock (all prior waiters drained).
      existing.locked = true;
      return Promise.resolve();
    }

    // Lock is held by another coroutine — push into FIFO queue.
    return new Promise<void>((resolve) => {
      existing.queue.push(resolve);
    });
  }

  /**
   * Release the lock for `matchId`.
   *
   * - If there are queued waiters, the lock is *transferred* to the next one
   *   (FIFO) — `locked` stays `true`, their resolve callback is invoked.
   * - If no waiters remain, the entry is deleted to prevent unbounded growth.
   */
  private release(matchId: MatchId): void {
    const entry = this.locks.get(matchId);
    if (!entry) {
      // Entry was disposed while we held the lock — nothing to do.
      return;
    }

    const next = entry.queue.shift();
    if (next) {
      // Transfer lock: entry.locked stays true, wake up next waiter.
      next();
    } else {
      // Queue is empty — remove entry to keep the map lean.
      this.locks.delete(matchId);
    }
  }
}
