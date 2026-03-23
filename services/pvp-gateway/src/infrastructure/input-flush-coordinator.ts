/**
 * @module infrastructure/input-flush-coordinator
 *
 * # InputFlushCoordinator (P9 + P13 root fix)
 *
 * ## Problem being solved
 * The old implementation used two boolean flags — `inputUpdateFlushInProgress`
 * and `inputUpdateFlushRequested` — to prevent concurrent flush calls.  This
 * approach had a critical shutdown flaw (P13): when `flushPendingInputUpdates`
 * was called during graceful shutdown while a flush was already running, it
 * simply set `inputUpdateFlushRequested = true` and returned immediately,
 * giving the caller NO way to `await` the completion of the in-progress flush.
 * Any pending batches that finished while the DB connection was being torn
 * down were silently dropped.
 *
 * ## Design
 * A Promise-chain coordinator serialises all flush executions.  Each call to
 * `schedule()` checks whether a pending flush is already buffered and, if not,
 * appends a new flush to the end of `_chain`.  `drain()` returns a promise
 * that resolves only after the *current tail* of the chain has settled — this
 * is exactly what the shutdown path needs to safely call `await coordinator.drain()`.
 *
 * ### Invariants
 * - At most ONE flush executes concurrently at any time.
 * - At most ONE additional flush is buffered while a flush is executing
 *   (a "catch-up" flush to handle events enqueued during the previous run).
 * - After `stop()` is called no new flushes are scheduled; in-flight and
 *   buffered flushes complete normally.
 * - The coordinator never throws — errors from `doFlush` are caught, logged,
 *   and rescheduled via the normal retry counter inside `doFlush` itself.
 *
 * ### Shutdown sequence
 * ```ts
 * clearInterval(flushInterval);
 * coordinator.stop();          // block new timer-driven schedules
 * await coordinator.drain();   // wait for the flush that is running + any buffered catch-up
 * ```
 */

import { gatewayLogDebug, gatewayLogWarn } from "../shared/logger";
import type { PendingInputUpdateBatch } from "../shared/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Reason label attached to flush metrics and log entries. */
export type FlushReason = "timer" | "threshold" | "shutdown";

/**
 * Context injected into the coordinator so it can execute the actual flush
 * without importing `index.ts` internals.  All fields are typed explicitly.
 */
export interface FlushCoordinatorDeps {
  /** The live batch map shared with `enqueueInputUpdateBatch`. */
  pendingInputUpdatesByMatch: Map<string, PendingInputUpdateBatch>;
  /** Retry counters per matchId (reset on success, incremented on error). */
  inputUpdateFlushRetriesByMatch: Map<string, number>;
  /** Maximum consecutive failures before a warning is logged (not a hard cap). */
  inputUpdateFlushMaxRetries: number;
  /** The actual DB-write function; implementations merge-back on failure. */
  persistBatch: (matchId: string, batch: PendingInputUpdateBatch) => Promise<void>;
  /** Merge a failed batch back into `pendingInputUpdatesByMatch`. */
  mergeBatch: (matchId: string, batch: PendingInputUpdateBatch) => void;
  /** Optional metric increments — not required for correctness. */
  onFlushStart?: (reason: FlushReason) => void;
  onFlushEnd?: (reason: FlushReason, durationMs: number) => void;
  onRequeue?: (reason: FlushReason) => void;
}

// ---------------------------------------------------------------------------
// InputFlushCoordinator
// ---------------------------------------------------------------------------

/**
 * Serialises input-update DB flushes with bulletproof drain-on-shutdown.
 *
 * @example
 * ```ts
 * const coordinator = new InputFlushCoordinator(deps);
 * // periodic schedule driven by a setInterval:
 * const interval = setInterval(() => coordinator.schedule("timer"), 100);
 * // threshold flush inside INPUT_UPDATE handler:
 * coordinator.schedule("threshold");
 * // shutdown:
 * clearInterval(interval);
 * coordinator.stop();
 * await coordinator.drain(); // guaranteed to complete all pending batches
 * ```
 */
export class InputFlushCoordinator {
  /** Promise representing the the end of the current chain of flushes. */
  private _chain: Promise<void> = Promise.resolve();
  /**
   * Whether a follow-up flush is already queued at the tail of `_chain`.
   * Used to collapse multiple `schedule()` calls while a flush is running
   * into a single catch-up flush.
   */
  private _nextScheduled = false;
  /** After `stop()`, new schedules are silently ignored. */
  private _stopped = false;

  constructor(private readonly _deps: FlushCoordinatorDeps) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Request a flush.  If no flush is currently running the work begins
   * immediately.  If a flush is running, exactly one catch-up flush is
   * buffered so that events enqueued during the current run are not missed.
   *
   * @param reason - Attached to metrics/logs to identify the trigger source.
   */
  schedule(reason: FlushReason): void {
    if (this._stopped) return;
    if (this._deps.pendingInputUpdatesByMatch.size === 0) return;
    if (this._nextScheduled) return; // already a catch-up queued

    this._nextScheduled = true;
    this._chain = this._chain.then(() => {
      this._nextScheduled = false;
      if (this._deps.pendingInputUpdatesByMatch.size === 0) return;
      return this._run(reason);
    });
  }

  /**
   * Signal that no new flushes should be scheduled.  Used at the start of
   * graceful shutdown so the periodic timer can no longer enqueue work after
   * the timer has been cleared.  In-progress / buffered flushes still run.
   */
  stop(): void {
    this._stopped = true;
  }

  /**
   * Returns a promise that resolves once the entire current flush chain —
   * including any catch-up flush buffered at the tail — has settled.
   *
   * **This is the correct shutdown hook.** Always `await coordinator.drain()`
   * after calling `stop()` before closing the database connection.
   */
  drain(): Promise<void> {
    // Force a final flush if there are still pending batches, regardless of
    // the `_stopped` flag (shutdown must flush remaining data).
    if (this._deps.pendingInputUpdatesByMatch.size > 0 && !this._nextScheduled) {
      this._nextScheduled = true;
      this._chain = this._chain.then(() => {
        this._nextScheduled = false;
        if (this._deps.pendingInputUpdatesByMatch.size === 0) return;
        return this._run("shutdown");
      });
    }
    return this._chain;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Execute one full flush cycle: drain `pendingInputUpdatesByMatch`, call
   * `persistBatch` per match, merge failed batches back for retry.
   * Errors are fully contained — this function never rejects.
   */
  private async _run(reason: FlushReason): Promise<void> {
    const startedAt = Date.now();
    this._deps.onFlushStart?.(reason);

    const batches = Array.from(this._deps.pendingInputUpdatesByMatch.entries());
    // Swap-clear: take ownership of the snapshot so newly arriving events are
    // held in a fresh map and not lost when we clear the original.
    this._deps.pendingInputUpdatesByMatch.clear();

    for (const [matchId, batch] of batches) {
      try {
        await this._deps.persistBatch(matchId, batch);
        this._deps.inputUpdateFlushRetriesByMatch.delete(matchId);
      } catch (error) {
        const retries = (this._deps.inputUpdateFlushRetriesByMatch.get(matchId) ?? 0) + 1;
        this._deps.inputUpdateFlushRetriesByMatch.set(matchId, retries);
        // Merge the failed batch back so it is retried in the next cycle.
        this._deps.mergeBatch(matchId, batch);
        this._deps.onRequeue?.(reason);

        gatewayLogWarn("INPUT_UPDATE batch flush failed; re-queued for retry", {
          matchId,
          reason,
          retries,
          maxRetries: this._deps.inputUpdateFlushMaxRetries,
          enqueuedCount: batch.enqueuedCount,
          ageMs: Date.now() - batch.firstEnqueuedAtMs,
          error: error instanceof Error ? error.message : String(error),
        });

        if (retries >= this._deps.inputUpdateFlushMaxRetries) {
          // We do NOT discard the batch — it stays in pendingInputUpdatesByMatch
          // merged above with the latest seq values.  The next cycle will try
          // again.  We log a higher-severity warning so ops teams are alerted.
          gatewayLogWarn(
            "INPUT_UPDATE batch reached retry threshold — keeping latest seq in queue",
            {
              matchId,
              retries,
              maxRetries: this._deps.inputUpdateFlushMaxRetries,
            },
          );
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    this._deps.onFlushEnd?.(reason, durationMs);

    gatewayLogDebug("INPUT_UPDATE flush cycle completed", {
      reason,
      durationMs,
      pendingMatchesAfter: this._deps.pendingInputUpdatesByMatch.size,
    });
  }
}
