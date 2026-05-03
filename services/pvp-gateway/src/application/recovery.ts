/**
 * @module application/recovery
 *
 * Startup recovery: rebuild in-memory `LocalMatch` state for all non-terminal
 * matches from the PostgreSQL database, then re-arm the correct start-sequence
 * timers via `MatchStartOrchestrator`.
 *
 * ## Why this module exists
 *
 * The previous startup sweep only activated overdue COUNTDOWN rows whose
 * `serverStartAt` had already passed (RC-4 fix).  All other active match
 * states — PENDING (waiting_for_both) and RUNNING — were silently dropped on
 * restart.  After a restart, reconnecting players would receive a "match not
 * found" error for a match that was still persisted in the DB.
 *
 * `rehydrateActiveMatches` fixes this by:
 * 1. Querying ALL non-terminal matches from the DB (PENDING / COUNTDOWN / RUNNING).
 * 2. Rebuilding `LocalMatch` objects from the persisted `liveState` JSONB.
 * 3. Inserting them into `state.matches` so reconnect / join handlers can find them.
 * 4. Re-arming start-sequence timers via `orchestrator.rehydrate()`.
 * 5. Immediately activating any COUNTDOWN match whose start time has passed.
 * 6. Optionally restarting AI simulations for live bot matches.
 */

import type { MatchLiveState } from "../match-live-state";
import { matchStateFromDbStatus } from "../match-live-state";
import type { LocalMatch, LocalParticipant } from "../shared/types";
import type { MatchId, RoomCode } from "../shared/branded-ids";
import type { MatchState, InMemoryState } from "../state";
import type { MatchStartOrchestrator } from "./match-start-orchestrator";
import type { MatchRepository } from "../infrastructure/repositories/match-repository";
import { gatewayLogError, gatewayLogInfo, gatewayLogWarn } from "../shared/logger";

// =============================================================================
// Public interface
// =============================================================================

export interface RehydrateParams {
  /** Repository used to query non-terminal DB rows. */
  matchRepository: MatchRepository;
  /** Mutable in-memory match store to populate. */
  state: InMemoryState;
  /** Orchestrator that owns start-sequence timers. */
  orchestrator: MatchStartOrchestrator;
  /**
   * Only recover matches updated within this window (ms before now).
   * Defaults to 24 hours.  Set to undefined to recover all active matches
   * regardless of age.
   */
  maxAgeMs?: number;
  /**
   * Called once per COUNTDOWN match whose `serverStartAt` has already passed.
   *
   * The match has already been inserted into `state.matches` before this is
   * called.  The callback should attempt a DB transition to RUNNING and return
   * without throwing (errors are caught by the caller).
   */
  onActivateOverdueCountdown: (matchId: string) => Promise<void>;
  /**
   * Optional: called once per RUNNING match that has an AI participant so the
   * caller can restart the in-process AI simulation.
   */
  onRestartAiSimulation?: (params: {
    matchId: string;
    humanUserId: string;
    aiUserId: string;
    humanInput: string;
    aiInput: string;
  }) => void;
}

export interface RehydrateResult {
  /** Number of matches successfully loaded into state.matches. */
  recovered: number;
  /** Number of overdue COUNTDOWN matches activated. */
  activatedCountdown: number;
  /** Number of matches that could not be recovered (logged individually). */
  failed: number;
}

// =============================================================================
// Internal helpers
// =============================================================================

function buildLocalParticipants(liveState: MatchLiveState): Map<string, LocalParticipant> {
  const participants = new Map<string, LocalParticipant>();
  for (const [userId, p] of Object.entries(liveState.participants)) {
    participants.set(userId, {
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      slot: p.slot,
      input: p.input,
      seq: p.seq,
      errors: p.errors,
      wpm: p.wpm,
      accuracy: p.accuracy,
      finishedAt: p.finishedAt,
      lastInputAtMs: p.lastInputAtMs ?? undefined,
      lastInputLen: undefined,
      inputEvents: [],
    });
  }
  return participants;
}

function buildLocalMatch(row: {
  id: string;
  status: string;
  revision: number;
  liveState: MatchLiveState;
  textSnapshot: string;
  textId: string | null;
  inputNonce: string | null;
  serverStartAt: Date | null;
  roomCode: string | null;
}): LocalMatch {
  const ls = row.liveState;

  // Prefer the epoch-ms value stored inside liveState JSONB over the DB
  // TIMESTAMP column, which is susceptible to timezone drift on non-UTC hosts.
  const serverStartAtMs =
    ls.serverStartAtEpochMs ??
    (row.serverStartAt ? row.serverStartAt.getTime() : Date.now());

  return {
    matchId: row.id as unknown as MatchId,
    roomCode: (row.roomCode ?? null) as unknown as RoomCode | null,
    state: ls.state,
    stateChangedAt: ls.stateChangedAtMs ?? Date.now(),
    revision: row.revision,
    lastSnapshotBroadcastAtMs: 0,
    status: row.status,
    textSnapshot: row.textSnapshot,
    textId: row.textId,
    inputNonce: row.inputNonce,
    serverStartAtMs,
    participants: buildLocalParticipants(ls),
    endedReason: ls.endedReason ?? null,
    forfeitedUserId: ls.forfeitedUserId ?? null,
    rematchMatchId: (ls.rematchMatchId ?? null) as unknown as MatchId | null,
    finalizedAtMs: ls.finalizedAtMs ?? null,
    cleanupScheduledAtMs: null,
    reconnectUntilByUserId: ls.reconnectUntilByUserId ?? {},
    // Replay last ~20 deltas from persisted liveState for reconnect support.
    recentDeltas: (ls.deltas ?? []).slice(-20),
    tieWindowStartedAt: ls.tieWindowStartedAt ?? null,
    isLowConfidence: ls.isLowConfidence ?? false,
  };
}

// =============================================================================
// Main export
// =============================================================================

/**
 * Rebuild in-memory state for all non-terminal matches and re-arm timers.
 *
 * Safe to call multiple times (skips matches already present in state.matches).
 * Must be awaited before the WebSocket server starts accepting connections.
 */
export async function rehydrateActiveMatches(params: RehydrateParams): Promise<RehydrateResult> {
  const {
    matchRepository,
    state,
    orchestrator,
    maxAgeMs,
    onActivateOverdueCountdown,
    onRestartAiSimulation,
  } = params;

  let rows: Awaited<ReturnType<typeof matchRepository.loadAllActive>>;
  try {
    rows = await matchRepository.loadAllActive({ maxAgeMs });
  } catch (err: unknown) {
    gatewayLogError("[Recovery] loadAllActive query failed — startup recovery skipped", err);
    return { recovered: 0, activatedCountdown: 0, failed: 0 };
  }

  if (rows.length === 0) {
    gatewayLogInfo("[Recovery] No active matches found — nothing to recover");
    return { recovered: 0, activatedCountdown: 0, failed: 0 };
  }

  gatewayLogInfo("[Recovery] Recovering active matches", { count: rows.length });

  let recovered = 0;
  let activatedCountdown = 0;
  let failed = 0;
  const nowMs = Date.now();

  for (const row of rows) {
    try {
      if (!row.liveState) {
        gatewayLogWarn("[Recovery] Skipping match with null liveState", {
          matchId: row.id,
          status: row.status,
        });
        failed++;
        continue;
      }

      // Skip if already loaded (e.g. picked up by a fast-path concurrent handler).
      if (state.matches.has(row.id)) {
        recovered++;
        continue;
      }

      const match = buildLocalMatch(row as { liveState: MatchLiveState } & typeof row);

      // state.matches stores MatchState; LocalMatch is structurally compatible.
      state.matches.set(row.id, match as unknown as MatchState);

      // Re-arm start-sequence timers for matches that haven't gone live yet.
      if (row.status === "PENDING" || row.status === "COUNTDOWN") {
        orchestrator.rehydrate(match, row.liveState);
      }

      // Immediately activate any COUNTDOWN match whose start time has passed.
      if (row.status === "COUNTDOWN") {
        const startAtMs =
          row.liveState.serverStartAtEpochMs ??
          (row.serverStartAt ? row.serverStartAt.getTime() : 0);

        if (nowMs >= startAtMs) {
          await onActivateOverdueCountdown(row.id).catch((err: unknown) => {
            gatewayLogError(
              "[Recovery] Failed to activate overdue countdown match",
              err,
              { matchId: row.id },
            );
          });
          activatedCountdown++;
        }
      }

      // Restart AI simulation for live matches that have an AI participant.
      if (row.status === "RUNNING" && onRestartAiSimulation) {
        const userIds = Object.keys(row.liveState.participants);
        const aiUserId = userIds.find((uid) => uid.startsWith("ai:"));
        const humanUserId = userIds.find((uid) => !uid.startsWith("ai:"));

        if (aiUserId && humanUserId) {
          const aiPart = row.liveState.participants[aiUserId];
          const humanPart = row.liveState.participants[humanUserId];
          onRestartAiSimulation({
            matchId: row.id,
            humanUserId,
            aiUserId,
            humanInput: humanPart?.input ?? "",
            aiInput: aiPart?.input ?? "",
          });
        }
      }

      recovered++;
    } catch (err: unknown) {
      gatewayLogError("[Recovery] Failed to recover match", err, {
        matchId: row.id,
        status: row.status,
      });
      failed++;
    }
  }

  gatewayLogInfo("[Recovery] Startup recovery complete", {
    recovered,
    activatedCountdown,
    failed,
    total: rows.length,
  });

  return { recovered, activatedCountdown, failed };
}
