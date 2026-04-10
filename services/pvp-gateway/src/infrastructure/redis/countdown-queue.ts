/**
 * @module infrastructure/redis/countdown-queue
 *
 * Redis sorted-set backed countdown task queue.
 *
 * Each match whose countdown is pending is stored as a member of the sorted
 * set `pvp:countdown:tasks` with score = activationEpochMs.  The `pollDue`
 * method uses an atomic Lua script to ZRANGEBYSCORE + ZREM in a single round
 * trip, preventing double-processing across gateway instances.
 *
 * ## Key properties
 * - **Durability**: activation time survives gateway restarts.
 * - **Exactness**: a match is processed at most once per cycle (atomic Lua).
 * - **Idempotency**: `enqueue` uses ZADD which overwrites stale scores.
 * - **Low overhead**: a single sorted-set with O(log N) enqueue/remove.
 */

import type { Redis } from "ioredis";

// =============================================================================
// CONSTANTS
// =============================================================================

const QUEUE_KEY = "pvp:countdown:tasks";

// =============================================================================
// LUA SCRIPT — atomic poll-and-remove
// =============================================================================

/**
 * Atomically retrieves up to `limit` members whose score (activationEpochMs)
 * is <= nowMs, removes them from the set, and returns their matchIds.
 *
 * KEYS[1]  = sorted set key
 * ARGV[1]  = nowMs (epoch ms, as a string)
 * ARGV[2]  = limit (max entries to return per call)
 *
 * Returns an array of matchId strings (may be empty).
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

export interface RedisCountdownQueue {
  /**
   * Schedule a countdown activation for the given matchId at activationEpochMs.
   * Overwrites any previously stored entry for this matchId (ZADD upsert).
   */
  enqueue(matchId: string, activationEpochMs: number): Promise<void>;

  /**
   * Cancel a pending countdown activation for the given matchId.
   * No-op if the matchId is not in the queue.
   */
  remove(matchId: string): Promise<void>;

  /**
   * Atomically retrieve and remove all entries whose activationEpochMs <= nowMs.
   * Returns the matchIds of due entries (empty array if none are due).
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
 * Create a Redis-backed countdown queue using the given ioredis client.
 */
export function createRedisCountdownQueue(redis: Redis): RedisCountdownQueue {
  /**
   * Cached SHA-1 of POLL_DUE_LUA for EVALSHA (avoids re-transmitting the
   * script on every poll).  Cleared on NOSCRIPT errors (e.g. Redis restart).
   */
  let pollDueSha: string | null = null;

  return {
    async enqueue(matchId, activationEpochMs) {
      await redis.zadd(QUEUE_KEY, String(activationEpochMs), matchId);
    },

    async remove(matchId) {
      await redis.zrem(QUEUE_KEY, matchId);
    },

    async pollDue(nowMs = Date.now(), limit = 50) {
      const evalArgs = [1, QUEUE_KEY, String(nowMs), String(limit)] as const;

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
        pollDueSha = await redis.script("LOAD", POLL_DUE_LUA) as string;
      } catch {
        // Non-fatal — next call will EVAL again and retry the cache load.
      }
      return Array.isArray(result) ? (result as string[]) : [];
    },
  };
}
