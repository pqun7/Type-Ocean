/**
 * @module matchmaking/queue-adapter
 *
 * # IQueueAdapter — P10: Unified Redis / Local queue interface
 *
 * ## Problem
 * The old code exposed four separate callbacks in `GatewayDeps`:
 *   `queueJoin`, `queueLeave`, `readQueueMeta`, `tryMatchQueuedUser`
 *
 * Each of these returned `null` or `0` when Redis was absent, but callers were
 * forced to check `deps.redisBus` separately to decide whether to call them at
 * all.  This created duplicated branching logic and made the queue paths harder
 * to test in isolation.
 *
 * ## Design
 * A single `IQueueAdapter` interface replaces the four callbacks.  Two
 * concrete implementations are provided:
 *
 * - `RedisQueueAdapter` — wraps the four Redis-backed closures from `main()`.
 * - `LocalMemoryQueueAdapter` — no-op implementation that returns safe defaults
 *   for all operations; used when `PVP_USE_REDIS=false` (single-instance mode).
 *
 * `index.ts` creates the correct adapter at startup and passes it via
 * `GatewayDeps.queueAdapter`.  Command handlers no longer need to branch on
 * `deps.redisBus` for queue operations.
 *
 * ## Note on local-mode correctness
 * In local mode the actual queue matching is done synchronously inside
 * `queue-join.ts` via `enqueueOrMatchInMemory()` and `InMemoryState` — the
 * adapter is never the source of truth for local queue state.  The local
 * adapter's `leave()` returning `0` is intentional: callers that need to
 * remove a user from the in-memory queue must call
 * `deps.state.removeFromQueue()` directly, as they do today.
 */

import type { ConnectionUser } from "../state";
import type { QueuedUserMeta } from "../shared/types";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Ranked-matchmaking queue abstraction.
 * Implementations must be safe to call unconditionally — methods return
 * `null` / `0` rather than throwing when the underlying backend is absent.
 */
export interface IQueueAdapter {
  /**
   * Enqueue a user in the rated bucket.
   * Returns the stored `QueuedUserMeta`, or `null` when the backend is
   * unavailable (local/single-instance mode).
   */
  join(user: ConnectionUser): Promise<QueuedUserMeta | null>;

  /**
   * Remove a user from the queue.
   * Returns the number of entries deleted (`1` = removed, `0` = not found /
   * backend unavailable).
   */
  leave(userId: string): Promise<number>;

  /**
   * Read the queue metadata stored for a user.
   * Returns `null` when the user is not queued or the backend is unavailable.
   */
  readMeta(userId: string): Promise<QueuedUserMeta | null>;

  /**
   * Attempt to find a match for `user` against the current queue.
   * Returns `null` when no suitable opponent is found or the backend is
   * unavailable.
   */
  tryMatch(
    user: ConnectionUser,
  ): Promise<{ otherId: string; me: QueuedUserMeta; other: QueuedUserMeta | null } | null>;
}

// ---------------------------------------------------------------------------
// Redis implementation
// ---------------------------------------------------------------------------

/** Deps injected into `RedisQueueAdapter` from `main()` closures. */
export interface RedisQueueAdapterFns {
  queueJoin: (user: ConnectionUser) => Promise<QueuedUserMeta | null>;
  queueLeave: (userId: string) => Promise<number>;
  readQueueMeta: (userId: string) => Promise<QueuedUserMeta | null>;
  tryMatchQueuedUser: (
    user: ConnectionUser,
  ) => Promise<{ otherId: string; me: QueuedUserMeta; other: QueuedUserMeta | null } | null>;
}

/**
 * Queue adapter backed by Redis sorted sets.
 * Delegates directly to the four closures created in `main()`.
 */
export class RedisQueueAdapter implements IQueueAdapter {
  constructor(private readonly _fns: RedisQueueAdapterFns) {}

  join(user: ConnectionUser): Promise<QueuedUserMeta | null> {
    return this._fns.queueJoin(user);
  }

  leave(userId: string): Promise<number> {
    return this._fns.queueLeave(userId);
  }

  readMeta(userId: string): Promise<QueuedUserMeta | null> {
    return this._fns.readQueueMeta(userId);
  }

  tryMatch(
    user: ConnectionUser,
  ): Promise<{ otherId: string; me: QueuedUserMeta; other: QueuedUserMeta | null } | null> {
    return this._fns.tryMatchQueuedUser(user);
  }
}

// ---------------------------------------------------------------------------
// Local / no-op implementation
// ---------------------------------------------------------------------------

/**
 * No-op queue adapter for single-instance (non-Redis) mode.
 *
 * All operations return safe empty values.  The real queue work in
 * local mode is handled by `enqueueOrMatchInMemory()` and `InMemoryState`
 * directly inside the command handlers.
 */
export class LocalMemoryQueueAdapter implements IQueueAdapter {
  join(): Promise<QueuedUserMeta | null> {
    return Promise.resolve(null);
  }

  leave(): Promise<number> {
    return Promise.resolve(0);
  }

  readMeta(): Promise<QueuedUserMeta | null> {
    return Promise.resolve(null);
  }

  tryMatch(): Promise<{ otherId: string; me: QueuedUserMeta; other: QueuedUserMeta | null } | null> {
    return Promise.resolve(null);
  }
}
