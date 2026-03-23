/**
 * @module shared/types
 *
 * Core in-memory domain types for the PvP gateway.
 *
 * These types describe the **live, in-process state** of a match — richer
 * than what is persisted to the database.  They are the single source of
 * truth for what other gateway modules may reference.
 *
 * ## Design notes
 * - `LocalMatch` and `LocalParticipant` are **mutable** objects stored in
 *   `InMemoryState.matches`.  All writes must happen inside a
 *   `MatchLockRegistry.withLock(matchId, …)` call (P4).
 * - `WsConn` is intentionally **not** defined here — it lives in
 *   `presentation/ws-connection.ts` because it depends on the WebSocket class
 *   and presentation-layer token metadata.
 *
 * ## Import policy
 * This module may only import from:
 * - `./branded-ids`  (same shared/ layer)
 * - `../match-fsm`   (no cycle — match-fsm has no imports from shared/)
 * - `../matchmaking/bands` (type-only — MatchmakingPreference)
 */

import type { MatchId, RoomCode } from "./branded-ids";
import type { MatchLifecycleState } from "../match-fsm";
import type { MatchmakingPreference } from "../matchmaking/bands";

// =============================================================================
// MATCH DELTA (for delta replay on reconnect)
// =============================================================================

/**
 * A single recorded state-change event, buffered per match so reconnecting
 * clients can replay recent progress without a full DB fetch.
 *
 * Only the last `MATCH_DELTA_BUFFER_LIMIT` deltas are retained per match.
 */
export interface MatchDelta {
  /** Monotonically increasing DB revision at the time of the change. */
  revision: number;
  /** `"PROGRESS"` for keystroke events; `"MATCH_STATE"` for lifecycle events. */
  type: "PROGRESS" | "MATCH_STATE";
  /** Opaque serialisable payload forwarded to the reconnecting client. */
  payload: unknown;
  /** Wall-clock timestamp (ms since epoch) when the delta was recorded. */
  atMs: number;
}

// =============================================================================
// PENDING INPUT UPDATE BATCH
// =============================================================================

/**
 * Transient batch state for the deferred input-update flush queue.
 *
 * One entry exists per match that has enqueued but not yet flushed
 * INPUT_UPDATE events.  Flushed after `PVP_INPUT_UPDATE_FLUSH_INTERVAL_MS`
 * or when `PVP_INPUT_UPDATE_FLUSH_MAX_ENQUEUED` is reached.
 */
export interface PendingInputUpdateBatch {
  /** Highest accepted `seq` per userId in this batch. */
  maxSeqByUser: Map<string, number>;
  /** Total number of INPUT_UPDATE events enqueued since last flush. */
  enqueuedCount: number;
  /** Wall-clock timestamp (ms) of the first enqueue in this batch. */
  firstEnqueuedAtMs: number;
}

// =============================================================================
// QUEUE METADATA
// =============================================================================

/**
 * Metadata stored for each user while they are in the matchmaking queue.
 * Used both in the Redis sorted-set implementation and the in-process fallback.
 */
export interface QueuedUserMeta {
  /** Queue bucket key (band + mode string). */
  bucketKey: string;
  /** Wall-clock timestamp (ms) when the user joined the queue. */
  joinedAtMs: number;
  /** The user's ranked matchmaking preference (language, etc.). */
  preference: MatchmakingPreference;
  /** Current Elo-style rating used for band bucketing. */
  rating: number;
}

// =============================================================================
// INPUT EVENT (anti-cheat timeline)
// =============================================================================

/**
 * One entry in a participant's per-keystroke event timeline.
 * Accumulated while the match is live; used by the anti-cheat anomaly scorer.
 */
export interface InputEvent {
  /** Wall-clock timestamp (ms) of the keystroke. */
  atMs: number;
  /** Length of the participant's full input string after this keystroke. */
  inputLength: number;
  /**
   * Net characters added or removed by this event
   * (`inputLength - previousInputLength`).
   */
  deltaChars: number;
  /** Live WPM at the moment this event was recorded. */
  wpm: number;
}

// =============================================================================
// PARTICIPANT PLACEMENT (final ranking)
// =============================================================================

/**
 * A participant's final placement in a completed match.
 * Populated during finalization and used in result persistence.
 */
export interface Placement {
  /** 1-based finishing position (1 = first to complete). */
  position: number;
  userId: string;
  username: string;
  wpm: number;
  accuracy: number;
  errors: number;
  /** Total time (ms) to complete the text. */
  timeMs: number;
}

// =============================================================================
// LOCAL PARTICIPANT
// =============================================================================

/**
 * In-memory representation of a single participant during a live match.
 *
 * This is richer than what is stored in the database — it contains:
 * - Full live input string (for full-recompute stats, P5).
 * - Anti-cheat `inputEvents` timeline.
 * - Sequence number for replay protection.
 *
 * Mutations to fields in this interface must happen inside the match's
 * exclusive {@link MatchLockRegistry} lock.
 */
export interface LocalParticipant {
  userId: string;
  username: string;
  avatar: string | null;
  /** 0-based slot index (determines display order). */
  slot: number;
  /** Full input string typed so far (never truncated). */
  input: string;
  /** Monotonically increasing per-message sequence number. */
  seq: number;
  /** Count of characters where `input[i] !== textSnapshot[i]`. */
  errors: number;
  /** Current WPM — recomputed from `input` on every keystroke. */
  wpm: number;
  /** Current accuracy (0–100) — recomputed from `input` on every keystroke. */
  accuracy: number;
  /** Wall-clock timestamp (ms) when the participant finished, or `null`. */
  finishedAt: number | null;
  /** Timestamp (ms) of the most recent INPUT_UPDATE, for rate-limit checks. */
  lastInputAtMs?: number;
  /** Length of `input` at the most recent INPUT_UPDATE, for delta checks. */
  lastInputLen?: number;
  /** Anti-cheat event log for this participant. */
  inputEvents: InputEvent[];
}

// =============================================================================
// LOCAL MATCH
// =============================================================================

/**
 * In-memory representation of a live (or recently-finished) PvP match.
 *
 * One instance lives in `InMemoryState.matches` for the duration of the
 * match plus `MATCH_RESULT_RETENTION_MS`.  All field writes must be
 * serialised through the match's FIFO lock (P4).
 *
 * ### Lifecycle
 * ```
 * (created) → waiting_for_both → countdown → live → finished
 *                ↘ aborted            ↗ aborted
 * ```
 */
export interface LocalMatch {
  matchId: MatchId;
  /** Non-null for room matches; `null` for ranked 1v1. */
  roomCode: RoomCode | null;
  state: MatchLifecycleState;
  /** Wall-clock timestamp (ms) of the last state transition. */
  stateChangedAt: number;
  /** DB revision at the time this in-memory copy was last synchronised. */
  revision: number;
  /** Timestamp (ms) of the last periodic MATCH_STATE broadcast. */
  lastSnapshotBroadcastAtMs: number;
  /** Legacy status string for backward compatibility. */
  status: string;
  /** The full text participants must type. */
  textSnapshot: string;
  /** Identifier of the selected text (`pvp_match.textId`). */
  textId: string | null;
  /**
   * Per-match anti-replay nonce embedded in every MATCH_FOUND payload.
   * Each INPUT_UPDATE must echo this value (P11).
   */
  inputNonce: string | null;
  /** Wall-clock timestamp (ms) when the match server-side countdown begins. */
  serverStartAtMs: number;
  /** Live participant states keyed by `userId`. */
  participants: Map<string, LocalParticipant>;
  /**
   * Why the match ended.  `null` while the match is live or not yet
   * finalised.
   */
  endedReason:
    | "completed"
    | "opponent_disconnected"
    | "aborted"
    | "no_show"
    | null;
  /** `userId` of the participant who forfeited, or `null`. */
  forfeitedUserId: string | null;
  /** `MatchId` of the rematch, once both players accept. */
  rematchMatchId: MatchId | null;
  /** Wall-clock timestamp (ms) when finalization completed. */
  finalizedAtMs: number | null;
  /** Wall-clock timestamp (ms) when the cleanup timer was scheduled. */
  cleanupScheduledAtMs: number | null;
  /**
   * Per-userId expiry timestamps indicating how long this match's slot
   * should remain available for a disconnected participant to reconnect.
   */
  reconnectUntilByUserId: Record<string, number>;
  /** Ring-buffer of recent state-change events for delta replay. */
  recentDeltas: MatchDelta[];
  /**
   * Timestamp (ms) when the first participant finished — marks the start of
   * the tie-detection window.  `null` before any participant finishes.
   */
  tieWindowStartedAt: number | null;
}
