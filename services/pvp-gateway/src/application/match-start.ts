import type { MatchLifecycleState } from "../match-fsm";
import type { MatchLiveState } from "../match-live-state";

export function shouldActivateCountdownMatch(params: {
  matchState: MatchLifecycleState;
  nowMs: number;
  serverStartAtMs: number;
}): boolean {
  return params.matchState === "countdown" && params.nowMs >= params.serverStartAtMs;
}

export function activateMatchLiveState(liveState: MatchLiveState, nowMs: number): MatchLiveState {
  if (liveState.state === "live") {
    return liveState;
  }

  return {
    ...liveState,
    state: "live",
    stateChangedAtMs: nowMs,
  };
}