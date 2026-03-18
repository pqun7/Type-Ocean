import type { MatchLifecycleState } from "./match-fsm";

export type DisconnectForfeitPolicy = "grace_resume" | "immediate_forfeit" | "none";

export function shouldRejectDuplicateMatchTab(activeSocketsForSameMatchUser: number) {
  return activeSocketsForSameMatchUser > 0;
}

export function getDisconnectForfeitPolicy(params: { roomCode: string | null; participantCount: number }): DisconnectForfeitPolicy {
  if (params.roomCode !== null) return "none";
  if (params.participantCount !== 2) return "none";
  return "grace_resume";
}

export function shouldScheduleDisconnectForfeit(params: {
  policy: DisconnectForfeitPolicy;
  participantCount: number;
  otherActiveSocketsForUser: number;
  matchStatus: string;
  matchState: MatchLifecycleState;
}) {
  if (params.policy !== "grace_resume") return false;
  if (params.participantCount !== 2) return false;
  if (params.otherActiveSocketsForUser > 0) return false;
  if (params.matchState !== "live") return false;
  if (params.matchStatus === "FINISHED" || params.matchStatus === "ABORTED") return false;
  return true;
}

export function shouldDeferDisconnectForfeitForJoin(params: { joinInFlight: boolean }) {
  return params.joinInFlight;
}

export function getStaleMatchAbortReason(params: {
  state: MatchLifecycleState;
  stateAgeMs: number;
  maxCountdownAgeMs: number;
  maxLiveAgeMs: number;
}) {
  if (params.state === "countdown" && params.stateAgeMs > params.maxCountdownAgeMs) {
    return "stale_countdown" as const;
  }

  if (params.state === "live" && params.stateAgeMs > params.maxLiveAgeMs) {
    return "stale_live" as const;
  }

  return null;
}