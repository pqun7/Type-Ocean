export type MatchTerminalStatus = "PENDING" | "COUNTDOWN" | "RUNNING" | "FINISHED" | "ABORTED";

export function isTerminalPvpMatchStatus(status: string) {
  return status === "FINISHED" || status === "ABORTED";
}

export function canOpenPvpMatchPage(params: {
  status: string;
  participantExists: boolean;
}) {
  return params.participantExists && !isTerminalPvpMatchStatus(params.status);
}

export function canJoinPvpMatchSocket(params: {
  status: string;
  participantExists: boolean;
  userId: string;
  forfeitedUserId?: string | null;
  endedReason?: "completed" | "opponent_disconnected" | "aborted" | "no_show" | null;
}) {
  if (!params.participantExists) {
    return { allowed: false as const, reason: "not_participant" as const };
  }

  if (isTerminalPvpMatchStatus(params.status)) {
    return { allowed: false as const, reason: "match_closed" as const };
  }

  if (params.endedReason === "opponent_disconnected" && params.forfeitedUserId === params.userId) {
    return { allowed: false as const, reason: "disconnect_forfeit" as const };
  }

  return { allowed: true as const };
}