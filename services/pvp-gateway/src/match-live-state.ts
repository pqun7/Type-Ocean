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
  // Internal counters used for incremental metric updates.
  correctChars?: number;
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
