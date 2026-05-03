/**
 * @module infrastructure/redis/timer-queues
 *
 * Generic Redis sorted-set backed deferred timer queue.
 *
 * Each pending deadline is stored as a member of the sorted set with
 * score = deadlineEpochMs.  The `pollDue` method atomically retrieves and
 * removes all members whose deadline has passed, preventing double-processing.
 *
 * Used to persist forfeit and no-show timer deadlines so they survive a
 * gateway crash or restart.  The local `setTimeout` is the primary trigger;
 * this queue acts as a durable fallback that fires on the next poll cycle
 * after a restart.
 *
 * ## Key properties
 * - **Durability**: deadline survives gateway restarts (requires Redis AOF/RDB).
 * - **Exactness**: each entry processed at most once per poll (atomic Lua).
 * - **Idempotency**: `enqueue` uses ZADD which overwrites stale scores.
 * - **No new dependencies**: built on the same `ioredis` client already wired.
 *
 * ## Key naming
 * Callers supply the sorted-set key.  Recommended constants live in
 * `shared/config`:
 *   - `DISCONNECT_FORFEIT_QUEUE_KEY = "pvp:disconnect:forfeit:tasks"`
 *   - `NOSHOW_QUEUE_KEY            = "pvp:noshow:tasks"`
 */

import type { Redis } from "ioredis";

// =============================================================================
// LUA SCRIPT — atomic poll-and-remove
// =============================================================================

/**
 * Atomically retrieves up to `limit` members whose score (deadlineEpochMs)
 * is <= nowMs, removes them from the set, and returns their ids.
 *
 * KEYS[1]  = sorted set key
 * ARGV[1]  = nowMs (epoch ms, as a string)
 * ARGV[2]  = limit (max entries to return per call)
 *
 * Returns an array of id strings (may be empty).
 */
const POLL_DUE_LUA = `
local members = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
if #members > 0 then
  redis.call('ZREM', KEYS[1], unpack(members))
end
return members
`;

// =============================================================================
// INTERFACE
// =============================================================================

export interface RedisDeferredTimerQueue {
  /**
   * Schedule a deferred action for the given id at deadlineEpochMs.
   * If an entry already exists for this id, it is overwritten (ZADD upsert).
   */
  enqueue(id: string, deadlineEpochMs: number): Promise<void>;

  /**
   * Cancel the pending deadline for the given id.
   * No-op if the id is not in the queue.
   */
  remove(id: string): Promise<void>;

  /**
   * Atomically retrieve and remove all entries whose deadlineEpochMs <= nowMs.
   * Returns the ids of due entries (empty array if none are due).
   *
   * @param nowMs  Current epoch milliseconds (default: Date.now()).
   * @param limit  Maximum number of entries to return per call (default: 50).
   */
  pollDue(nowMs?: number, limit?: number): Promise<string[]>;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a Redis-backed deferred timer queue using the given ioredis client
 * and sorted-set key.
 *
 * @param redis    An initialised ioredis `Redis` instance.
 * @param queueKey The Redis sorted-set key to use (e.g. `"pvp:disconnect:forfeit:tasks"`).
 */
export function createRedisDeferredTimerQueue(redis: Redis, queueKey: string): RedisDeferredTimerQueue {
  /**
   * Cached SHA-1 of POLL_DUE_LUA for EVALSHA (avoids re-transmitting the
   * script on every poll).  Cleared on NOSCRIPT errors (e.g. Redis restart).
   */
  let pollDueSha: string | null = null;

  return {
    async enqueue(id, deadlineEpochMs) {
      await redis.zadd(queueKey, String(deadlineEpochMs), id);
    },

    async remove(id) {
      await redis.zrem(queueKey, id);
    },

    async pollDue(nowMs = Date.now(), limit = 50) {
      const evalArgs = [1, queueKey, String(nowMs), String(limit)] as const;

      if (pollDueSha) {
        try {
          const result = await redis.evalsha(pollDueSha, ...evalArgs);
          return Array.isArray(result) ? (result as string[]) : [];
        } catch (err: unknown) {
          const isNoscript = err instanceof Error && err.message.includes("NOSCRIPT");
          if (!isNoscript) throw err;
          // Script evicted — fall through to EVAL and reload.
          pollDueSha = null;
        }
      }

      const result = await redis.eval(POLL_DUE_LUA, ...evalArgs);
      // Eagerly cache the SHA for subsequent calls.
      try {
        pollDueSha = (await redis.script("LOAD", POLL_DUE_LUA)) as string;
      } catch {
        // Non-fatal — next call will EVAL again and retry the cache load.
      }
      return Array.isArray(result) ? (result as string[]) : [];
    },
  };
}
