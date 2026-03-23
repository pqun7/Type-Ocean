/**
 * @module match-aggregate
 *
 * Command Bus + Aggregate Root for PvP match mutations.
 *
 * ## Problems addressed: P2, P4
 *
 * `index.ts` mutates `LocalMatch` objects from many scattered call sites, each
 * interleaving async DB work with in-memory state changes.  This creates races
 * (P4) and can leave in-memory state out of sync with the database (P2).
 *
 * ## Solution
 *
 * A `MatchAggregate` acts as the **single choke-point** for all writes to a
 * `LocalMatch`.  Every mutation is expressed as a `MatchCommand` and dispatched
 * through `MatchAggregate.dispatch()`, which serialises execution per match via
 * `MatchLockRegistry.withLock()`.
 *
 * Concrete command handlers are **injectable** at construction time via
 * {@link MatchCommandHandlers}.  This decouples the aggregate from direct
 * `LocalMatch` / `MatchRepository` imports and makes it fully testable — tests
 * can pass mock handlers and verify ordering guarantees without a real database.
 *
 * ## Phase note
 * Phase 2 wires `MatchLockRegistry` (the locking primitive) into `index.ts`
 * directly via a `withMatchLock` helper.  `match-aggregate.ts` provides the
 * canonical types, `MatchConflictError`, and the `MatchAggregate` class that
 * Phase 3 will use as the single entry point when the monolith is broken into
 * application-service modules.
 *
 * See problems P2, P4 in `problem.md`.
 */

import type { MatchId } from "../../shared/branded-ids";
import type { MatchLockRegistry } from "./match-lock";

// =============================================================================
// COMMAND TYPES
// =============================================================================

/**
 * An in-memory INPUT_UPDATE that applies the participant's latest keystroke
 * to the live match state.  DB persistence is enqueued asynchronously outside
 * the lock so the lock is held for the minimum time.
 */
export type InputUpdateCommand = {
  readonly type: "INPUT_UPDATE";
  readonly matchId: MatchId;
  readonly userId: string;
  /**
   * The full current input string — already validated and clamped to
   * `textSnapshot.length` by the caller before dispatch.
   */
  readonly input: string;
  readonly seq: number;
  /** The `Date.now()` value captured at the WS message arrival, passed in for
   * deterministic testing. */
  readonly nowMs: number;
};

/**
 * Records the authoritative server-start timestamp for a match entering the
 * live state.  Uses a DB-first, optimistic-revision write with one automatic
 * retry on conflict.
 */
export type StartCountdownCommand = {
  readonly type: "START_COUNTDOWN";
  readonly matchId: MatchId;
  readonly serverStartAtMs: number;
};

/**
 * Finalises a match that completed normally (all participants finished typing).
 * Delegates to the existing `finalizeMatchResults` function inside the lock so
 * that concurrent INPUT_UPDATE messages cannot interleave during finalisation.
 */
export type FinalizeCompleteCommand = {
  readonly type: "FINALIZE_COMPLETE";
  readonly matchId: MatchId;
};

/**
 * Hard-aborts a match (no-show, stale session, etc.).
 * Delegates to the existing `abortMatchLifecycle` function inside the lock.
 */
export type AbortCommand = {
  readonly type: "ABORT";
  readonly matchId: MatchId;
};

/** Union of all commands that can mutate the live state of a match. */
export type MatchCommand =
  | InputUpdateCommand
  | StartCountdownCommand
  | FinalizeCompleteCommand
  | AbortCommand;

// =============================================================================
// HANDLER CONTRACT
// =============================================================================

/**
 * Concrete implementations for each command type.
 *
 * Each handler is invoked **inside** the per-match exclusive lock.  Handlers
 * MUST NOT call `matchLockRegistry.withLock` for the **same** `matchId`
 * (would deadlock).
 *
 * @example
 * ```ts
 * const handlers: MatchCommandHandlers = {
 *   inputUpdate:      async (cmd) => { /* mutate in-memory state *\/ },
 *   startCountdown:   async (cmd) => { /* DB-first optimistic write *\/ },
 *   finalizeComplete: async (cmd) => { /* delegate to finalizeMatchResults *\/ },
 *   abort:            async (cmd) => { /* delegate to abortMatchLifecycle *\/ },
 * };
 * ```
 */
export type MatchCommandHandlers = {
  readonly inputUpdate:      (cmd: InputUpdateCommand)      => Promise<void>;
  readonly startCountdown:   (cmd: StartCountdownCommand)   => Promise<void>;
  readonly finalizeComplete: (cmd: FinalizeCompleteCommand) => Promise<void>;
  readonly abort:            (cmd: AbortCommand)            => Promise<void>;
};

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Thrown by the `startCountdown` handler when an optimistic-concurrency DB
 * update fails on two consecutive attempts (concurrent revision bump from
 * another gateway instance or a race with a background job).
 *
 * Callers should treat this as a terminal failure for the match and trigger an
 * abort.
 */
export class MatchConflictError extends Error {
  /** The match for which the conflict occurred. */
  readonly matchId: MatchId;
  /** Short identifier of the operation that conflicted (e.g. `"start_countdown"`). */
  readonly operation: string;

  constructor(matchId: MatchId, operation: string) {
    super(
      `Optimistic concurrency conflict on match ${matchId} during "${operation}"`,
    );
    this.name = "MatchConflictError";
    this.matchId = matchId;
    this.operation = operation;
  }
}

// =============================================================================
// AGGREGATE
// =============================================================================

/**
 * Command Bus + Aggregate Root for PvP match mutations.
 *
 * All match state changes **should** eventually go through `dispatch()`.
 * Direct mutation of `LocalMatch` outside this class is a code smell that
 * Phase 3 will eliminate through further modularisation.
 *
 * @example
 * ```ts
 * const aggregate = new MatchAggregate(lockRegistry, handlers);
 *
 * // Concurrent dispatches for the same match are serialised automatically.
 * await aggregate.dispatch({ type: "INPUT_UPDATE", matchId, userId, ... });
 * await aggregate.dispatch({ type: "FINALIZE_COMPLETE", matchId });
 * ```
 */
export class MatchAggregate {
  /**
   * @param lockRegistry - Shared per-match lock registry.  `dispatch` acquires
   *                       the exclusive lock for the target match before
   *                       invoking the handler.
   * @param handlers     - Concrete handler implementations, typically closures
   *                       that capture the `main()` execution context.
   */
  constructor(
    private readonly lockRegistry: MatchLockRegistry,
    private readonly handlers: MatchCommandHandlers,
  ) {}

  /**
   * Dispatch a command to the appropriate handler under the per-match
   * exclusive lock.
   *
   * - Concurrent dispatches for the **same** `matchId` execute in FIFO order.
   * - Concurrent dispatches for **different** `matchId`s run in parallel.
   *
   * @param cmd - The command describing the desired mutation.
   * @throws `MatchConflictError` when the `startCountdown` handler detects two
   *         consecutive DB revision conflicts.
   * @throws Any error thrown by the concrete handler.
   */
  async dispatch(cmd: MatchCommand): Promise<void> {
    return this.lockRegistry.withLock(cmd.matchId, async () => {
      switch (cmd.type) {
        case "INPUT_UPDATE":
          return this.handlers.inputUpdate(cmd);
        case "START_COUNTDOWN":
          return this.handlers.startCountdown(cmd);
        case "FINALIZE_COMPLETE":
          return this.handlers.finalizeComplete(cmd);
        case "ABORT":
          return this.handlers.abort(cmd);
      }
    });
  }
}
