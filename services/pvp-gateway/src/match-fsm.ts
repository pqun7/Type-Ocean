export type MatchLifecycleState = "lobby" | "waiting_for_both" | "countdown" | "live" | "finished" | "aborted";

export const MATCH_STATE_TRANSITIONS: Readonly<Record<MatchLifecycleState, readonly MatchLifecycleState[]>> = {
  lobby: ["waiting_for_both", "countdown", "aborted"],
  waiting_for_both: ["countdown", "aborted"],
  countdown: ["live", "aborted", "finished"],
  live: ["finished", "aborted"],
  finished: [],
  aborted: [],
};

export type MatchStateContainer = {
  state: MatchLifecycleState;
  stateChangedAt: number;
};

export function canTransition(from: MatchLifecycleState, to: MatchLifecycleState) {
  return from === to || MATCH_STATE_TRANSITIONS[from].includes(to);
}

export function transitionMatchState<T extends MatchStateContainer>(
  value: T,
  to: MatchLifecycleState,
  changedAt = Date.now()
): T {
  if (!canTransition(value.state, to)) {
    throw new Error(`Invalid match transition: ${value.state} -> ${to}`);
  }

  if (value.state === to) {
    return { ...value };
  }

  return {
    ...value,
    state: to,
    stateChangedAt: changedAt,
  };
}

export function matchStateFromDbStatus(status: string): MatchLifecycleState {
  switch (status) {
    case "COUNTDOWN":
      return "countdown";
    case "RUNNING":
      return "live";
    case "FINISHED":
      return "finished";
    case "ABORTED":
      return "aborted";
    case "PENDING":
    default:
      return "waiting_for_both";
  }
}

export function matchStateToDbStatus(state: MatchLifecycleState): string {
  switch (state) {
    case "lobby":
    case "waiting_for_both":
      return "PENDING";
    case "countdown":
      return "COUNTDOWN";
    case "live":
      return "RUNNING";
    case "finished":
      return "FINISHED";
    case "aborted":
      return "ABORTED";
  }
}

export function matchStateToLegacyStatus(state: MatchLifecycleState): "COUNTDOWN" | "RUNNING" | "FINISHED" | "ABORTED" | "PENDING" {
  switch (state) {
    case "lobby":
    case "waiting_for_both":
      return "PENDING";
    case "countdown":
      return "COUNTDOWN";
    case "live":
      return "RUNNING";
    case "finished":
      return "FINISHED";
    case "aborted":
      return "ABORTED";
  }
}