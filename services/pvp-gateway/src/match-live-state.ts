import type { MatchLifecycleState } from "./match-fsm";

export type MatchLiveParticipantState = {
  userId: string;
  username: string;
  avatar: string | null;
  slot: number;
  input: string;
  seq: number;
  errors: number;
  wpm: number;
  accuracy: number;
  finishedAt: number | null;
  lastInputAtMs: number | null;
  /**
   * Number of characters in `input` that exactly match the reference text at
   * the same index. Populated by `recomputeParticipantStats()` on every
   * INPUT_UPDATE and persisted inside the `liveState` JSONB column so that
   * stats survive a gateway restart without a separate in-memory accumulator Map.
   *
   * Always equals `(correctChars / input.length) * 100` when cross-checked
   * against `accuracy`. Required (not optional) since the P5/P12 refactor.
   */
  correctChars: number;
  /**
   * @deprecated Derivable as `input.length - correctChars`.
   * Kept as optional for backward-compatibility when reading JSONB rows
   * written by older gateway versions. Do not write this field from new code.
   */
  mismatchChars?: number;
  inputEvents?: Array<{
    atMs: number;
    inputLength: number;
    deltaChars: number;
    wpm: number;
  }>;
};

export type MatchLiveState = {
  state: MatchLifecycleState;
  stateChangedAtMs: number;
  participants: Record<string, MatchLiveParticipantState>;
  forfeitedUserId: string | null;
  endedReason: "completed" | "opponent_disconnected" | "aborted" | "no_show" | null;
  rematchMatchId: string | null;
  finalizedAtMs: number | null;
  reconnectUntilByUserId?: Record<string, number>;
  /** Timestamp (ms) when the first participant finished (tie-detection window). */
  tieWindowStartedAt?: number | null;
  /**
   * `true` when this was a bot-fallback (low-confidence) match.
   * Carried through JSONB so it survives gateway restarts.
   */
  isLowConfidence?: boolean;
  /**
   * Durable start-sequence phase tag persisted in JSONB so that a gateway
   * restart can re-arm the correct timer without guessing from state alone.
   *
   * - `"waiting_for_both"` — ranked match created, no-show timer running, waiting for both MATCH_JOINs.
   * - `"no_show_armed"`    — at least one player joined; no-show deadline still pending.
   * - `"countdown_armed"`  — both joined; countdown tick + activation timers are running.
   * - `"live"`             — match is live; start-sequence complete.
   *
   * Absent in room matches that go directly to countdown without a wait phase.
   */
  startPhase?: "waiting_for_both" | "no_show_armed" | "countdown_armed" | "live";
  /**
   * UTC epoch ms of match start (when typing begins). Stored here as a plain
   * number inside the JSONB `liveState` column so it is immune to the
   * TIMESTAMP WITHOUT TIMEZONE timezone mis-parse that affects the
   * `serverStartAt` Date column on non-UTC database hosts.
   */
  serverStartAtEpochMs?: number;
  deltas?: Array<{
    revision: number;
    type: "PROGRESS" | "MATCH_STATE";
    payload: unknown;
    atMs: number;
  }>;
};

export const ACTIVE_DB_STATUSES = ["PENDING", "COUNTDOWN", "RUNNING"] as const;

export function matchStateFromDbStatus(status: string): MatchLifecycleState {
  if (status === "COUNTDOWN") return "countdown";
  if (status === "RUNNING") return "live";
  if (status === "FINISHED") return "finished";
  if (status === "ABORTED") return "aborted";
  return "waiting_for_both";
}

export function dbStatusFromMatchState(state: MatchLifecycleState): "PENDING" | "COUNTDOWN" | "RUNNING" | "FINISHED" | "ABORTED" {
  if (state === "countdown") return "COUNTDOWN";
  if (state === "live") return "RUNNING";
  if (state === "finished") return "FINISHED";
  if (state === "aborted") return "ABORTED";
  return "PENDING";
}

export function createInitialLiveState(params: {
  state: MatchLifecycleState;
  participants: Array<{
    userId: string;
    username: string;
    avatar: string | null;
    slot: number;
  }>;
  nowMs?: number;
}): MatchLiveState {
  const nowMs = params.nowMs ?? Date.now();
  const participants: Record<string, MatchLiveParticipantState> = {};

  for (const participant of params.participants) {
    participants[participant.userId] = {
      userId: participant.userId,
      username: participant.username,
      avatar: participant.avatar,
      slot: participant.slot,
      input: "",
      seq: 0,
      errors: 0,
      wpm: 0,
      accuracy: 100,
      finishedAt: null,
      lastInputAtMs: null,
      correctChars: 0,
      mismatchChars: 0,
      inputEvents: [],
    };
  }

  return {
    state: params.state,
    stateChangedAtMs: nowMs,
    participants,
    forfeitedUserId: null,
    endedReason: null,
    rematchMatchId: null,
    finalizedAtMs: null,
    reconnectUntilByUserId: {},
    deltas: [],
  };
}
