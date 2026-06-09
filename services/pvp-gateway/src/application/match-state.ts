/**
 * @module application/match-state
 *
 * Pure in-memory match state helpers.
 *
 * These functions read and mutate `LocalMatch` / `LocalParticipant`
 * objects that live inside `InMemoryState.matches`.  They have no
 * network I/O and make no database calls.  When they raise events
 * they require an `eventBus` argument — everything else is either
 * passed as a parameter or imported from `shared/`.
 *
 * ## Import policy
 * May import from: shared/, domain/match/, match-fsm, match-sync,
 * match-live-state, events (type-only), state (type-only).
 */

import { transitionMatchState, matchStateToLegacyStatus, type MatchLifecycleState } from "../match-fsm";
import { recomputePvpParticipantStats } from "../domain/match/participant-stats";
import { type createGatewayEventBus } from "../events";
import { type InMemoryState } from "../state";
import { MATCH_DELTA_BUFFER_LIMIT } from "../shared/config";
import type { MatchLiveState } from "../match-live-state";
import type { LocalMatch } from "../shared/types";

// =============================================================================
// LIVE-STATE BUILDER
// =============================================================================

/**
 * Build a `MatchLiveState` snapshot from the current in-memory `LocalMatch`.
 *
 * Stats are fully recomputed (O(n ≤ 1000)) on every call via
 * `recomputeParticipantStats`, eliminating the backspace bug and the
 * external accumulator Map (P5/P3 fix).
 */
export function buildLiveStateFromLocalMatch(match: LocalMatch): MatchLiveState {
  const participants: MatchLiveState["participants"] = {};

  for (const participant of match.participants.values()) {
    const stats = recomputePvpParticipantStats({
      input: participant.input,
      textSnapshot: match.textSnapshot,
      startedAtMs: match.serverStartAtMs,
      nowMs: Date.now(),
      totalMistakes: participant.totalMistakes ?? participant.errors,
    });
    participants[participant.userId] = {
      userId: participant.userId,
      username: participant.username,
      avatar: participant.avatar,
      slot: participant.slot,
      input: participant.input,
      seq: participant.seq,
      errors: stats.errors,
      wpm: stats.wpm,
      accuracy: stats.accuracy,
      finishedAt: participant.finishedAt,
      lastInputAtMs: participant.lastInputAtMs ?? null,
      // correctChars is persisted in JSONB so it survives gateway restarts (P12).
      correctChars: stats.correctChars,
      totalMistakes: participant.totalMistakes ?? stats.errors,
      inputEvents: participant.inputEvents ?? [],
    };
  }

  return {
    state: match.state,
    stateChangedAtMs: match.stateChangedAt,
    participants,
    forfeitedUserId: match.forfeitedUserId ?? null,
    endedReason: match.endedReason ?? null,
    rematchMatchId: match.rematchMatchId ?? null,
    finalizedAtMs: match.finalizedAtMs ?? null,
    reconnectUntilByUserId: match.reconnectUntilByUserId ?? {},
    tieWindowStartedAt: match.tieWindowStartedAt ?? null,
    deltas: match.recentDeltas ?? [],
    isLowConfidence: match.isLowConfidence ?? false,
  };
}

// =============================================================================
// DELTA BUFFER
// =============================================================================

/**
 * Append a state-change delta to the match's ring buffer, pruning the oldest
 * entry if the limit is reached.
 */
export function appendMatchDelta(
  match: LocalMatch,
  delta: {
    type: "PROGRESS" | "MATCH_STATE";
    payload: unknown;
    atMs: number;
  },
): void {
  if (!match.recentDeltas) {
    match.recentDeltas = [];
  }

  match.recentDeltas.push({
    revision: match.revision,
    type: delta.type,
    payload: delta.payload,
    atMs: delta.atMs,
  });

  if (match.recentDeltas.length > MATCH_DELTA_BUFFER_LIMIT) {
    match.recentDeltas.splice(0, match.recentDeltas.length - MATCH_DELTA_BUFFER_LIMIT);
  }
}

// =============================================================================
// STATE LOOKUP
// =============================================================================

/**
 * Find the first non-terminal match in which `userId` is participating.
 * Returns `null` if the user has no active (non-finished/aborted) match.
 */
export function findActiveMatchByUserId(state: InMemoryState, userId: string): LocalMatch | null {
  for (const match of state.matches.values()) {
    if (!match.participants.has(userId)) continue;
    if (match.state === "finished" || match.state === "aborted") continue;
    return match as LocalMatch;
  }
  return null;
}

// =============================================================================
// STATE TRANSITION
// =============================================================================

/**
 * Apply a lifecycle state transition to a `LocalMatch`, emitting the
 * appropriate domain event.  Returns `false` if the transition was invalid
 * (and emits `match:invalid-transition` on the event bus).
 */
export function applyMatchTransition(params: {
  match: LocalMatch;
  nextState: MatchLifecycleState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  reason?: "completed" | "opponent_disconnected" | "aborted";
}): boolean {
  const { match, nextState, eventBus } = params;
  const from = match.state;

  try {
    const transitioned = transitionMatchState(
      match as unknown as Parameters<typeof transitionMatchState>[0],
      nextState,
    );
    match.state = transitioned.state as MatchLifecycleState;
    match.stateChangedAt = transitioned.stateChangedAt;
    match.status = matchStateToLegacyStatus(transitioned.state as MatchLifecycleState);
  } catch {
    eventBus.emit("match:invalid-transition", {
      matchId: match.matchId,
      from,
      to: nextState,
      roomCode: match.roomCode,
      atMs: Date.now(),
    });
    return false;
  }

  const event = {
    matchId: match.matchId,
    from,
    to: nextState,
    roomCode: match.roomCode,
    atMs: match.stateChangedAt,
  };

  if (nextState === "countdown") {
    eventBus.emit("match:countdown", event);
  } else if (nextState === "live") {
    eventBus.emit("match:live", event);
  } else if (nextState === "finished") {
    eventBus.emit("match:ended", { ...event, reason: params.reason ?? "completed" });
    eventBus.emit("match:finished", { ...event, reason: params.reason ?? "completed" });
  }

  return true;
}

// =============================================================================
// KEY HELPERS
// =============================================================================

/**
 * Build the compound key used to index disconnect-forfeit timers.
 * Format: `"<matchId>:<userId>"`.
 */
export function getDisconnectForfeitKey(matchId: string, userId: string): string {
  return `${matchId}:${userId}`;
}
