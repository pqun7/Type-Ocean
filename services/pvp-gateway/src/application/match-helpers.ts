/**
 * @module application/match-helpers
 *
 * Match lifecycle helpers: finalization locks, cleanup scheduling,
 * snapshot broadcasting, and idempotency key management.
 *
 * ## Import policy
 * May import from: shared/, domain/match/, application/deps,
 * application/match-state, presentation/ws-sender, match-sync, metrics, idempotency.
 */

import { buildMatchStatePayload, markMatchSnapshotBroadcast, shouldBroadcastPeriodicMatchSnapshot } from "../match-sync";
import { buildIdempotencyKey, getIdempotencyRecord, getIdempotencyTtlSeconds, setIdempotencyRecord, type IdempotencyRecord } from "../idempotency";
import { incrementGatewayMetric } from "../metrics";
import { MATCH_RESULT_RETENTION_MS } from "../shared/config";
import { type createGatewayEventBus } from "../events";
import { type InMemoryIdempotencyStore } from "../idempotency";
import { type RedisBus } from "../redis-bus";
import { appendMatchDelta } from "./match-state";
import { broadcastMatch } from "../presentation/ws-sender";
import type { GatewayDeps } from "./deps";
import type { LocalMatch } from "../shared/types";
import type { MatchId } from "../shared/branded-ids";

// =============================================================================
// FINALIZATION LOCK HELPERS
// =============================================================================

/**
 * Attempt to acquire the in-process finalization lock for `matchId`.
 * Returns `false` if the lock is already held (idempotency guard).
 */
export function tryBeginMatchFinalization(
  matchId: MatchId,
  deps: Pick<GatewayDeps, "matchFinalizationLocks">,
): boolean {
  if (deps.matchFinalizationLocks.has(matchId)) return false;
  deps.matchFinalizationLocks.add(matchId);
  return true;
}

/** Release the finalization lock for `matchId`. */
export function endMatchFinalization(
  matchId: MatchId,
  deps: Pick<GatewayDeps, "matchFinalizationLocks">,
): void {
  deps.matchFinalizationLocks.delete(matchId);
}

/**
 * Run `work` inside the finalization lock for `matchId`.
 * Returns `false` without running if the lock is already held.
 */
export async function runWithMatchFinalizationLock(
  matchId: MatchId,
  work: () => Promise<void>,
  deps: Pick<GatewayDeps, "matchFinalizationLocks">,
): Promise<boolean> {
  if (!tryBeginMatchFinalization(matchId, deps)) return false;
  try {
    await work();
    return true;
  } finally {
    endMatchFinalization(matchId, deps);
  }
}

// =============================================================================
// CLEANUP SCHEDULING
// =============================================================================

/** Cancel an existing scheduled cleanup timer for `matchId`, if any. */
export function clearScheduledMatchCleanup(
  matchId: MatchId,
  deps: Pick<GatewayDeps, "matchCleanupTimers">,
): void {
  const existing = deps.matchCleanupTimers.get(matchId);
  if (!existing) return;
  clearTimeout(existing);
  deps.matchCleanupTimers.delete(matchId);
}

/**
 * Schedule disposal of all per-match resources after `delayMs`.
 *
 * Delegates to `MatchCleanupService.dispose` which atomically releases all
 * 11 resource categories (timers, Sets, Maps, cache, state entry) — P3 fix.
 */
export function scheduleMatchCleanup(
  matchId: MatchId,
  deps: Pick<GatewayDeps, "matchCleanupTimers" | "matchCleanupService" | "state">,
  delayMs = MATCH_RESULT_RETENTION_MS,
): void {
  clearScheduledMatchCleanup(matchId, deps);
  const match = deps.state.matches.get(matchId) as LocalMatch | undefined;
  if (!match) return;

  match.cleanupScheduledAtMs = Date.now() + delayMs;
  const timer = setTimeout(() => {
    deps.matchCleanupService?.dispose(matchId);
  }, delayMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  deps.matchCleanupTimers.set(matchId, timer);
}

// =============================================================================
// SNAPSHOT BROADCAST
// =============================================================================

/**
 * Conditionally broadcast a periodic `MATCH_STATE` snapshot to all
 * participants.  Returns `true` if a snapshot was broadcast.
 */
export function maybeBroadcastMatchSnapshot(
  match: LocalMatch,
  nowMs: number,
  intervalMs: number,
  deps: Pick<GatewayDeps, "redisBus" | "matchCache" | "messageBatcher" | "gatewayMetrics">,
): boolean {
  if (!shouldBroadcastPeriodicMatchSnapshot(
    match as unknown as Parameters<typeof shouldBroadcastPeriodicMatchSnapshot>[0],
    nowMs,
    intervalMs,
  )) {
    incrementGatewayMetric("pvp_match_snapshot_skip_total", { state: match.state });
    return false;
  }

  markMatchSnapshotBroadcast(
    match as unknown as Parameters<typeof markMatchSnapshotBroadcast>[0],
    nowMs,
  );
  incrementGatewayMetric("pvp_match_snapshots_total", { state: match.state });

  const payload = buildMatchStatePayload(
    match as unknown as Parameters<typeof buildMatchStatePayload>[0],
    nowMs,
  );
  appendMatchDelta(match, { type: "MATCH_STATE", payload, atMs: nowMs });
  broadcastMatch(match.matchId, "MATCH_STATE", payload, deps);
  return true;
}

// =============================================================================
// IDEMPOTENCY HELPERS
// =============================================================================

/**
 * Look up an existing idempotency record for a `requestId`, if present.
 * Returns `null` when no `requestId` was provided (non-idempotent call).
 */
export async function loadIdempotencyHit(params: {
  redis: RedisBus["redis"] | null;
  store: InMemoryIdempotencyStore;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  userId: string;
  messageType: string;
  requestId?: string;
}): Promise<{ key: string; record: IdempotencyRecord | null } | null> {
  if (!params.requestId) return null;
  const key = buildIdempotencyKey(params.userId, params.messageType, params.requestId);
  const record = await getIdempotencyRecord({ redis: params.redis, store: params.store, key });
  params.eventBus.emit(record ? "idempotency:hit" : "idempotency:miss", {
    scope: params.messageType.toLowerCase(),
    userId: params.userId,
  });
  return { key, record };
}

/**
 * Persist an idempotency record, keyed by `key`.
 * No-ops when `key` is absent (non-idempotent call path).
 */
export async function storeIdempotencyHit(params: {
  redis: RedisBus["redis"] | null;
  store: InMemoryIdempotencyStore;
  key?: string;
  messageType: string;
  value: IdempotencyRecord;
}): Promise<void> {
  if (!params.key) return;
  await setIdempotencyRecord({
    redis: params.redis,
    store: params.store,
    key: params.key,
    value: params.value,
    ttlSeconds: getIdempotencyTtlSeconds(params.messageType),
  });
}

// =============================================================================
// MATCH LOCK WRAPPER
// =============================================================================

/**
 * Acquire the per-match FIFO exclusive lock from the registry, running `fn`
 * inside the lock.  Falls through without locking if the registry is `null`
 * (should never happen after `main()` startup, but guards test/shutdown edges).
 */
export async function withMatchLock<T>(
  matchId: MatchId,
  fn: () => Promise<T>,
  deps: Pick<GatewayDeps, "matchLockRegistry">,
): Promise<T> {
  if (deps.matchLockRegistry) return deps.matchLockRegistry.withLock(matchId, fn);
  return fn();
}
