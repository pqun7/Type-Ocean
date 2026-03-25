/**
 * @module application/finalize-match
 *
 * Match finalization use-cases:
 *  - `tryBeginMatchFinalizationWithDbLock` — acquire the DB-level finalization lock
 *  - `clearTerminalMatchLiveState` — wipe liveState column after terminal status
 *  - `finalizeMatchResults` — write final stats, Elo, broadcast RESULTS
 *  - `finalizeMatchIfComplete` — check all participants finished, then finalize
 *
 * ## Import policy
 * May import from: shared/, domain/match/, application/(deps|match-state|match-helpers|room-helpers),
 * presentation/ws-sender, drizzle schema, match-repository, anti-cheat, pvp-rating-cache, mmr, ai.
 */

import { and, eq, sql } from "drizzle-orm";

import {
  pvpMatches,
  pvpParticipants,
  pvpRatingChanges,
  pvpRatings,
} from "../../../../src/db/schema";
import { updateElo1v1 } from "../mmr";
import { ratingFromWpm } from "../ai";
import { MatchRepository } from "../match-repository";
import { matchStateToDbStatus } from "../match-fsm";
import { runGatewayTransaction } from "../gateway-db";
import { assessMatch } from "../anti-cheat/anomaly";
import { recordCheatAssessment } from "../anti-cheat/flagging";
import { clearReplayProtection } from "../anti-cheat/replay";
import { invalidatePvpSelfCaches } from "../pvp-rating-cache";
import { incrementGatewayMetric } from "../metrics";
import { isAiUserId } from "../shared/errors";
import { INSTANCE_ID, MATCH_TIE_WINDOW_MS } from "../shared/config";
import { gatewayLogDebug, gatewayLogError, gatewayLogInfo } from "../shared/logger";
import { toMatchId } from "../shared/branded-ids";
import { buildLiveStateFromLocalMatch, applyMatchTransition } from "./match-state";
import { runWithMatchFinalizationLock, scheduleMatchCleanup } from "./match-helpers";
import { restoreRoomAfterMatch } from "./room-helpers";
import { broadcastMatch } from "../presentation/ws-sender";
import type { GatewayDeps } from "./deps";
import type { LocalMatch, Placement } from "../shared/types";
import type { GatewayDb } from "../gateway-db";

// =============================================================================
// DB-LEVEL FINALIZATION LOCK
// =============================================================================

/**
 * Acquire a DB-level finalization lock on the match row (optimistic revision
 * check + `finalizing_instance_id` write).  Returns `false` if the lock is
 * already held by another instance or the match is already terminal.
 */
export async function tryBeginMatchFinalizationWithDbLock(params: {
  db: GatewayDb;
  match: LocalMatch;
}): Promise<boolean> {
  const repository = new MatchRepository(params.db);

  return repository.withTransaction(async (tx) => {
    const locked = await repository.loadForUpdate(tx, params.match.matchId);
    if (!locked) return false;
    if (locked.status === "FINISHED" || locked.status === "ABORTED") return false;

    const lockState = locked.liveState ?? buildLiveStateFromLocalMatch(params.match);
    lockState.finalizedAtMs = Date.now();

    const acquired = await repository.tryLockFinalization(tx, {
      matchId: params.match.matchId,
      expectedRevision: locked.revision,
      instanceId: INSTANCE_ID,
      liveState: lockState,
    });

    return acquired.acquired;
  });
}

// =============================================================================
// CLEAR TERMINAL LIVE STATE
// =============================================================================

/**
 * Once a match is FINISHED or ABORTED, wipe the `liveState` JSONB column to
 * free DB storage.  Uses a transaction + revision check so concurrent
 * instances cannot race.
 */
export async function clearTerminalMatchLiveState(params: {
  db: GatewayDb;
  matchId: string;
  status: "FINISHED" | "ABORTED";
}): Promise<void> {
  const repository = new MatchRepository(params.db);

  await repository.withTransaction(async (tx) => {
    const locked = await repository.loadForUpdate(tx, params.matchId);
    if (!locked) return;

    await repository.clearLiveStateOnTerminal(tx, {
      matchId: params.matchId,
      expectedRevision: locked.revision,
      status: params.status,
      endedAt: new Date(),
    });
  });
}

// =============================================================================
// FULL MATCH FINALIZATION
// =============================================================================

/**
 * Persist final stats, compute Elo, broadcast `RESULTS`, schedule cleanup,
 * and (for room matches) restore the room to `OPEN`.
 *
 * This is the "commit" of a match — every path that ends a match calls here.
 */
export async function finalizeMatchResults(params: {
  matchId: string;
  placements: Placement[];
  reason: "completed" | "opponent_disconnected" | "aborted";
  /** `true` when both players finished within `MATCH_TIE_WINDOW_MS`. */
  isTie?: boolean;
  deps: GatewayDeps;
}): Promise<void> {
  const { deps } = params;
  const match = deps.state.matches.get(params.matchId) as LocalMatch | undefined;
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;

  const dbLock = await tryBeginMatchFinalizationWithDbLock({ db: deps.db, match });
  if (!dbLock) return;

  gatewayLogInfo("Finalizing match results", {
    matchId: params.matchId,
    reason: params.reason,
    participants: params.placements.length,
  });

  match.endedReason = params.reason;
  applyMatchTransition({
    match,
    nextState: "finished",
    eventBus: deps.eventBus,
    reason: params.reason,
  });
  deps.state.clearAiInterval(match.matchId);

  await deps.db
    .update(pvpMatches)
    .set({
      status: matchStateToDbStatus("finished"),
      startedAt: new Date(match.serverStartAtMs),
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pvpMatches.id, match.matchId));

  await Promise.all(
    params.placements
      .filter((placement) => !isAiUserId(placement.userId))
      .map(async (placement) => {
        try {
          await deps.db
            .update(pvpParticipants)
            .set({
              finalWpm: placement.wpm,
              finalAccuracy: placement.accuracy,
              finalErrors: placement.errors,
              timeSpentSec: Math.max(0, Math.floor(placement.timeMs / 1000)),
              completedAt: new Date(match.serverStartAtMs + placement.timeMs),
              ...(params.reason === "opponent_disconnected" && match.forfeitedUserId === placement.userId
                ? { disconnectCount: sql`${pvpParticipants.disconnectCount} + 1` }
                : {}),
            })
            .where(
              and(
                eq(pvpParticipants.matchId, match.matchId),
                eq(pvpParticipants.userId, placement.userId),
              ),
            );
        } catch (error) {
          gatewayLogError("Failed to persist participant final stats", error, {
            matchId: match.matchId,
            userId: placement.userId,
            reason: params.reason,
          });
          throw error;
        }
      }),
  );

  let ratingChanges: Array<{ userId: string; before: number; after: number; delta: number }> = [];

  const ai = params.placements.find((p) => isAiUserId(p.userId)) ?? null;
  const humans = params.placements.filter((p) => !isAiUserId(p.userId));

  if (match.roomCode === null && params.placements.length === 2 && humans.length === 1 && ai) {
    // Human vs AI
    const humanId = humans[0]!.userId;
    const humanWon = params.placements[0]!.userId === humanId;

    await deps.db
      .insert(pvpRatings)
      .values({ userId: humanId })
      .onConflictDoNothing({ target: pvpRatings.userId });

    const humanRows = await deps.db
      .select({ rating: pvpRatings.rating, deviation: pvpRatings.deviation })
      .from(pvpRatings)
      .where(eq(pvpRatings.userId, humanId))
      .limit(1);

    const humanRow = humanRows[0];
    if (!humanRow) throw new Error(`Missing rating row for user ${humanId}`);

    const aiRating = ratingFromWpm(ai.wpm);
    const upd = updateElo1v1({
      a: { rating: humanRow.rating, deviation: humanRow.deviation },
      b: { rating: aiRating, deviation: 180 },
      aScore: humanWon ? 1 : 0,
    });

    await runGatewayTransaction(deps.db, async (tx) => {
      await tx.execute(sql`SAVEPOINT pvp_rating_updates`);
      try {
        await tx
          .update(pvpRatings)
          .set({
            rating: upd.nextA.rating,
            deviation: upd.nextA.deviation,
            gamesPlayed: sql`${pvpRatings.gamesPlayed} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(pvpRatings.userId, humanId));

        await tx.insert(pvpRatingChanges).values({
          matchId: match.matchId,
          userId: humanId,
          beforeRating: humanRow.rating,
          afterRating: upd.nextA.rating,
          delta: upd.deltaA,
        });

        await tx.execute(sql`RELEASE SAVEPOINT pvp_rating_updates`);
      } catch (error) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT pvp_rating_updates`);
        gatewayLogError("Failed to persist rating update (human vs AI)", error, {
          matchId: match.matchId,
          userId: humanId,
        });
        throw error;
      }
    });

    ratingChanges = [{ userId: humanId, before: humanRow.rating, after: upd.nextA.rating, delta: upd.deltaA }];
  } else if (match.roomCode === null && params.placements.length === 2 && humans.length === 2) {
    // Human vs Human (ranked)
    const playerAId = params.placements[0]!.userId;
    const playerBId = params.placements[1]!.userId;

    await Promise.all([
      deps.db.insert(pvpRatings).values({ userId: playerAId }).onConflictDoNothing({ target: pvpRatings.userId }),
      deps.db.insert(pvpRatings).values({ userId: playerBId }).onConflictDoNothing({ target: pvpRatings.userId }),
    ]);

    const [playerARows, playerBRows] = await Promise.all([
      deps.db
        .select({ rating: pvpRatings.rating, deviation: pvpRatings.deviation })
        .from(pvpRatings)
        .where(eq(pvpRatings.userId, playerAId))
        .limit(1),
      deps.db
        .select({ rating: pvpRatings.rating, deviation: pvpRatings.deviation })
        .from(pvpRatings)
        .where(eq(pvpRatings.userId, playerBId))
        .limit(1),
    ]);

    const playerARow = playerARows[0];
    const playerBRow = playerBRows[0];
    if (!playerARow || !playerBRow) throw new Error("Missing rating rows for match participants");

    const upd = updateElo1v1({
      a: { rating: playerARow.rating, deviation: playerARow.deviation },
      b: { rating: playerBRow.rating, deviation: playerBRow.deviation },
      aScore: params.isTie ? 0.5 : 1,
    });

    await runGatewayTransaction(deps.db, async (tx) => {
      await tx.execute(sql`SAVEPOINT pvp_rating_updates`);
      try {
        await tx
          .update(pvpRatings)
          .set({
            rating: upd.nextA.rating,
            deviation: upd.nextA.deviation,
            gamesPlayed: sql`${pvpRatings.gamesPlayed} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(pvpRatings.userId, playerAId));

        await tx
          .update(pvpRatings)
          .set({
            rating: upd.nextB.rating,
            deviation: upd.nextB.deviation,
            gamesPlayed: sql`${pvpRatings.gamesPlayed} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(pvpRatings.userId, playerBId));

        await tx
          .insert(pvpRatingChanges)
          .values([
            {
              matchId: match.matchId,
              userId: playerAId,
              beforeRating: playerARow.rating,
              afterRating: upd.nextA.rating,
              delta: upd.deltaA,
            },
            {
              matchId: match.matchId,
              userId: playerBId,
              beforeRating: playerBRow.rating,
              afterRating: upd.nextB.rating,
              delta: upd.deltaB,
            },
          ])
          .onConflictDoNothing({ target: [pvpRatingChanges.matchId, pvpRatingChanges.userId] });

        await tx.execute(sql`RELEASE SAVEPOINT pvp_rating_updates`);
      } catch (error) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT pvp_rating_updates`);
        gatewayLogError("Failed to persist rating update (human vs human)", error, {
          matchId: match.matchId,
          playerAId,
          playerBId,
        });
        throw error;
      }
    });

    ratingChanges = [
      { userId: playerAId, before: playerARow.rating, after: upd.nextA.rating, delta: upd.deltaA },
      { userId: playerBId, before: playerBRow.rating, after: upd.nextB.rating, delta: upd.deltaB },
    ];
  }

  // Anti-cheat assessment
  for (const participant of match.participants.values()) {
    if (isAiUserId(participant.userId)) continue;

    const assessment = await assessMatch(match.matchId, participant.userId, participant.inputEvents ?? [], {
      isBot: isAiUserId(participant.userId),
      redis: deps.redisBus?.redis ?? null,
    });

    await recordCheatAssessment({
      db: deps.db,
      userId: participant.userId,
      matchId: match.matchId,
      confidence: assessment.confidence,
      flags: assessment.flags,
      redis: deps.redisBus?.redis ?? null,
      metadata: {
        resultReason: params.reason,
        textId: match.textId,
        revision: match.revision,
      },
    });
  }

  // S3 fix: Send RESULTS before MATCH_ENDED so the client has stats ready
  // before the status transition — prevents a brief empty-results flash.
  broadcastMatch(match.matchId, "RESULTS", {
    matchId: match.matchId,
    placements: params.placements,
    ratingChanges,
  }, deps);

  broadcastMatch(match.matchId, "MATCH_ENDED", { matchId: match.matchId }, deps);

  for (const change of ratingChanges) {
    deps.connectionUserCache?.invalidate(change.userId);
  }

  await invalidatePvpSelfCaches(
    deps.redisBus?.redis ?? null,
    ratingChanges.map((change) => change.userId),
  );

  await clearReplayProtection(
    deps.redisBus?.redis ?? null,
    match.matchId,
    Array.from(match.participants.values())
      .filter((p) => !isAiUserId(p.userId))
      .map((p) => p.userId),
  );

  match.finalizedAtMs = Date.now();
  await clearTerminalMatchLiveState({
    db: deps.db,
    matchId: match.matchId,
    status: "FINISHED",
  });
  deps.matchCache?.clearMatch(match.matchId);
  scheduleMatchCleanup(toMatchId(match.matchId), deps);

  if (match.roomCode) {
    await restoreRoomAfterMatch(deps.db, match.roomCode, deps);
  }
}

// =============================================================================
// CONDITIONAL FINALIZATION (first-player-wins + tie window)
// =============================================================================

/**
 * Finalize the match as soon as the first participant finishes, using a short
 * tie-detection window (`MATCH_TIE_WINDOW_MS`) to catch near-simultaneous
 * finishes before committing the result.
 *
 * ### Algorithm
 * 1. If nobody has finished yet → no-op.
 * 2. If all participants have finished → cancel any pending timer and finalize
 *    immediately (covers the "second player finishes within the window" case).
 * 3. If only some participants have finished and no tie-window timer is set →
 *    record `tieWindowStartedAt` on the match and schedule a timer for
 *    `MATCH_TIE_WINDOW_MS` that re-calls this function.
 * 4. If a timer is already running and the window hasn't expired yet → wait.
 * 5. When the timer fires (or the window has already expired) → finalize with
 *    whoever has finished, awarding unfinished participants their current stats
 *    at position 2+.
 *
 * Tie detection: if both participants finished and their `finishedAt`
 * timestamps are within `MATCH_TIE_WINDOW_MS` of each other the result is
 * treated as a draw (`aScore: 0.5` in Elo).
 */
export async function finalizeMatchIfComplete(params: {
  matchId: string;
  deps: GatewayDeps;
}): Promise<void> {
  const { deps } = params;
  const match = deps.state.matches.get(params.matchId) as LocalMatch | undefined;
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;

  // Bail out early if another caller is already finalizing this match —
  // prevents duplicate "Tie-detection window expired" logs from concurrent
  // callers (AI tick, INPUT_UPDATE, setTimeout callback).
  if (deps.matchFinalizationLocks.has(toMatchId(params.matchId))) return;

  const all = Array.from(match.participants.values());
  const finished = all.filter((p) => p.finishedAt != null);
  const unfinished = all.filter((p) => p.finishedAt == null);

  if (finished.length === 0) return;

  const nowMs = Date.now();

  if (unfinished.length > 0 && !unfinished.every((p) => isAiUserId(p.userId))) {
    // Not everyone has finished yet.
    if (match.tieWindowStartedAt == null) {
      // First player just finished — start the tie-detection window.
      match.tieWindowStartedAt = nowMs;

      const existing = deps.firstPlaceFinalizationTimers.get(params.matchId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        deps.firstPlaceFinalizationTimers.delete(params.matchId);
        void finalizeMatchIfComplete(params);
      }, MATCH_TIE_WINDOW_MS);

      if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
        (timer as unknown as { unref: () => void }).unref();
      }

      deps.firstPlaceFinalizationTimers.set(params.matchId, timer);

      incrementGatewayMetric("pvp_match_finalize_skip_total", {
        reason: "tie_window_started",
        finished: finished.length,
        total: all.length,
      });
      gatewayLogDebug("Tie-detection window started after first participant finished", {
        matchId: params.matchId,
        finishedParticipants: finished.length,
        totalParticipants: all.length,
        tieWindowMs: MATCH_TIE_WINDOW_MS,
      });
      return;
    }

    // A window is already running — check whether it has expired yet.
    const elapsed = nowMs - match.tieWindowStartedAt;
    if (elapsed < MATCH_TIE_WINDOW_MS) {
      incrementGatewayMetric("pvp_match_finalize_skip_total", {
        reason: "tie_window_pending",
        finished: finished.length,
        total: all.length,
      });
      return;
    }

    // Window has expired — fall through to finalize with current state.
    gatewayLogDebug("Tie-detection window expired; finalizing with current participant state", {
      matchId: params.matchId,
      finishedParticipants: finished.length,
      totalParticipants: all.length,
    });
  }

  // Cancel any pending tie-window timer (we are finalizing now).
  const pendingTimer = deps.firstPlaceFinalizationTimers.get(params.matchId);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    deps.firstPlaceFinalizationTimers.delete(params.matchId);
  }

  // Determine if this is a tie: both players finished within the window.
  const isTie =
    finished.length >= 2 &&
    finished[0]!.finishedAt != null &&
    finished[1]!.finishedAt != null &&
    Math.abs(finished[0]!.finishedAt - finished[1]!.finishedAt) <= MATCH_TIE_WINDOW_MS;

  // Build placements: finished players ordered by finish time, then unfinished
  // players (awarded their live stats at the moment the match ends).
  const finishedSorted = [...finished].sort((a, b) => a.finishedAt! - b.finishedAt!);
  const placements: Placement[] = [
    ...finishedSorted.map((p, idx) => ({
      position: idx + 1,
      userId: p.userId,
      username: p.username,
      wpm: p.wpm,
      accuracy: p.accuracy,
      errors: p.errors,
      timeMs: p.finishedAt! - match.serverStartAtMs,
    })),
    ...unfinished.map((p, idx) => ({
      position: finished.length + idx + 1,
      userId: p.userId,
      username: p.username,
      wpm: p.wpm,
      accuracy: p.accuracy,
      errors: p.errors,
      timeMs: nowMs - match.serverStartAtMs,
    })),
  ];

  await runWithMatchFinalizationLock(toMatchId(params.matchId), async () => {
    gatewayLogInfo("Finalizing match results (first-wins)", {
      matchId: params.matchId,
      participants: all.length,
      isTie,
      placements: placements.map((p) => ({ userId: p.userId, position: p.position })),
    });
    await finalizeMatchResults({
      matchId: params.matchId,
      placements,
      reason: "completed",
      isTie,
      deps,
    });
  }, deps);
}
