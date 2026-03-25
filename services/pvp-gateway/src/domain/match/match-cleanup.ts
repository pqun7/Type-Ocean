/**
 * @module match-cleanup
 *
 * Centralised, single-responsibility service for disposing all per-match
 * in-memory resources when a match is removed from the gateway's live state.
 *
 * ## Why a dedicated service?
 *
 * Before this service existed, cleanup logic was scattered across multiple
 * functions in `index.ts`:
 *   - `scheduleMatchCleanup` cleared the timer + accumulators + cache.
 *   - `endMatchFinalization` cleared the finalization lock.
 *   - Various ad-hoc `state.matches.delete()` calls in different paths.
 *
 * This scatter meant any missed call site left a memory leak (P3).
 * Centralising into one `dispose()` method means there is exactly ONE place
 * to update when new per-match resources are introduced, and auditing
 * resource cleanup is trivial.
 *
 * See problem P3 in `problem.md`.
 */

import type { MatchCache } from "../../match-cache";
import type { InMemoryState } from "../../state";
import type { MatchId } from "../../shared/branded-ids";
import type { MatchLockRegistry } from "./match-lock";

/**
 * Service that centrally manages the full disposal of per-match resources.
 *
 * Inject the shared mutable collections once at startup and call
 * `dispose(matchId)` whenever a match should be removed from live state.
 *
 * ### Resources managed
 * - **Finalization lock** — prevents double-finalization races (was a `Set<MatchId>`).
 * - **Cleanup timer** — the deferred setTimeout that removes a finished match.
 * - **No-show timer** — per-match timeout for opponent arrival.
 * - **Disconnect-forfeit timers** — per-participant forfeit countdown.
 * - **Rematch-started flag** — `Set<string>` dedup entry (P3: never cleared before).
 * - **Pending input-update batch** — drops stale DB flush entries after cleanup.
 * - **Input flush-retry counter** — companion to the pending batch map.
 * - **Match lock entry** — releases the FIFO queue from `MatchLockRegistry` (P4).
 * - **AI simulation interval** — prevents orphaned AI tick timers.
 * - **Match socket cache** — releases WebSocket references tied to the match.
 * - **InMemoryState entry** — removes the match from the live state map.
 *
 * ### Resources no longer managed (intentionally)
 * - `participantMetricAccumulators` — eliminated entirely in P5/P12 refactor.
 *   Stats are now recomputed on every keystroke; no accumulator Map exists.
 */
export class MatchCleanupService {
  constructor(
    /** The set used to prevent concurrent finalization of the same match. */
    private readonly finalizationLocks: Set<MatchId>,
    /** Timer handles for deferred cleanup after a match ends. */
    private readonly cleanupTimers: Map<MatchId, ReturnType<typeof setTimeout>>,
    /** Timer handles for authoritative countdown-to-live transitions. */
    private readonly countdownActivationTimers: Map<MatchId, ReturnType<typeof setTimeout>>,
    /** Optional match socket cache; may be null if not initialised. */
    private readonly matchCache: MatchCache | null,
    /** Live in-memory match state store. */
    private readonly state: Pick<InMemoryState, "matches" | "clearAiInterval">,
    /**
     * Per-match no-show timers keyed by matchId string.
     * `dispose` cancels the timer and removes the entry.
     */
    private readonly noShowTimers: Map<string, NodeJS.Timeout>,
    /**
     * Per-participant disconnect-forfeit timers, keyed as `"${matchId}:${userId}"`.
     * `dispose` cancels all timers whose key starts with `"${matchId}:"`.
     */
    private readonly disconnectForfeitTimers: Map<string, NodeJS.Timeout>,
    /**
     * Set of match IDs for which a rematch countdown has been started.
     * **P3 fix**: previously `.delete()` was never called — permanent per-match leak.
     */
    private readonly rematchStartedByMatchId: Set<string>,
    /**
     * Pending batched INPUT_UPDATE DB write payloads keyed by matchId string.
     * Removed during disposal to prevent stale flushes after a match is gone.
     */
    private readonly pendingInputUpdates: Map<string, unknown>,
    /**
     * Tracks how many times the flush for a given match has been retried.
     * Companion to `pendingInputUpdates`; always cleared together.
     */
    private readonly inputFlushRetries: Map<string, number>,
    /**
     * FIFO per-match lock registry.
     * `dispose` drains any queued waiters and removes the entry.
     */
    private readonly lockRegistry: MatchLockRegistry,
  ) {}

  /**
   * Clear the finalization lock for a match, allowing re-finalization if needed.
   * Always call this inside a `finally` block after finalization work completes.
   */
  releaseFinalizationLock(matchId: MatchId): void {
    this.finalizationLocks.delete(matchId);
  }

  /**
   * Attempt to acquire the finalization lock for a match.
   *
   * @returns `true` if the lock was successfully acquired; `false` if another
   *          finalization is already in-progress for this match.
   */
  acquireFinalizationLock(matchId: MatchId): boolean {
    if (this.finalizationLocks.has(matchId)) return false;
    this.finalizationLocks.add(matchId);
    return true;
  }

  /**
   * Cancel any scheduled cleanup timer for a match without removing the match
   * from state. Use this before rescheduling cleanup with a different delay.
   */
  cancelCleanupTimer(matchId: MatchId): void {
    const existing = this.cleanupTimers.get(matchId);
    if (!existing) return;
    clearTimeout(existing);
    this.cleanupTimers.delete(matchId);
  }

  /**
   * Fully dispose of all per-match resources.
   *
   * This method is **idempotent** — calling it multiple times for the same
   * `matchId` is safe; subsequent calls are no-ops for already-cleared resources.
   *
   * ### What is cleared (in order)
   * 1. Any pending cleanup timer (prevents double-dispose).
   * 2. The finalization lock (the match is gone — no more finalization possible).
   * 3. The no-show timer for this match.
   * 4. All disconnect-forfeit timers for participants of this match.
   * 5. The `rematchStartedByMatchId` flag — **fixes P3 permanent leak**.
   * 6. The pending input-update batch — prevents stale DB flushes.
   * 7. The input flush-retry counter.
   * 8. The per-match lock entry in `MatchLockRegistry`.
   * 9. The AI simulation interval for this match.
   * 10. The match socket cache entry.
   * 11. The InMemoryState map entry (must be last).
   *
   * @param matchId - The branded match ID to dispose.
   */
  dispose(matchId: MatchId): void {
    // 1. Cancel the deferred cleanup timer (we are executing the cleanup now).
    this.cancelCleanupTimer(matchId);

    const countdownTimer = this.countdownActivationTimers.get(matchId);
    if (countdownTimer !== undefined) {
      clearTimeout(countdownTimer);
      this.countdownActivationTimers.delete(matchId);
    }

    // 2. Release the finalization lock — the match is being removed so no
    //    competing finalisation can happen after this point.
    this.releaseFinalizationLock(matchId);

    // 3. Cancel the no-show timer, if any.
    const noShowTimer = this.noShowTimers.get(matchId);
    if (noShowTimer !== undefined) {
      clearTimeout(noShowTimer);
      this.noShowTimers.delete(matchId);
    }

    // 4. Cancel all disconnect-forfeit timers for this match's participants.
    //    Keys are formatted as "${matchId}:${userId}".
    const disconnectPrefix = `${matchId}:`;
    for (const key of Array.from(this.disconnectForfeitTimers.keys())) {
      if (key.startsWith(disconnectPrefix)) {
        const timer = this.disconnectForfeitTimers.get(key);
        if (timer !== undefined) clearTimeout(timer);
        this.disconnectForfeitTimers.delete(key);
      }
    }

    // 5. Clear rematch-started dedup flag — FIXES P3 permanent per-match leak.
    //    Previously this Set was only ever `.add()`-ed to; `.delete()` was never called.
    this.rematchStartedByMatchId.delete(matchId);

    // 6. Drop queued input-update batch to prevent stale DB flushes after
    //    the match has been removed from live state.
    this.pendingInputUpdates.delete(matchId);

    // 7. Drop the flush-retry counter (companion to the pending input batch).
    this.inputFlushRetries.delete(matchId);

    // 8. Release the per-match FIFO lock entry.  Any still-queued waiters are
    //    drained (their promises resolve) so they can detect the gone-away match.
    this.lockRegistry.dispose(matchId);

    // 9. Stop any AI simulation intervals for this match.
    this.state.clearAiInterval(matchId);

    // 10. Release WebSocket socket-cache references tied to this match.
    this.matchCache?.clearMatch(matchId);

    // 11. Remove the live match entry from in-memory state — MUST be last so
    //     downstream guards (`state.matches.get(matchId)`) work through step 10.
    this.state.matches.delete(matchId);
  }
}
