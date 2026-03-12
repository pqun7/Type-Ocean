import type { MatchState, MatchParticipantState } from "./state";

export async function runDisconnectForfeitSequence(params: {
  sendMatchEnded: () => void | Promise<void>;
  finalizeResults: () => Promise<void>;
}) {
  await params.sendMatchEnded();
  await params.finalizeResults();
}

export type DisconnectForfeitOutcome = {
  winner: MatchParticipantState;
  loser: MatchParticipantState;
  placements: Array<{
    position: number;
    userId: string;
    username: string;
    wpm: number;
    accuracy: number;
    errors: number;
    timeMs: number;
  }>;
  message: {
    reason: "opponent_disconnected";
    message: string;
    finalResultsPending: true;
  };
};

export function buildDisconnectForfeitOutcome(params: {
  match: MatchState;
  forfeitedUserId: string;
  nowMs?: number;
}): DisconnectForfeitOutcome | null {
  const participants = Array.from(params.match.participants.values());
  if (participants.length !== 2) {
    return null;
  }

  const loser = params.match.participants.get(params.forfeitedUserId);
  const winner = participants.find((participant) => participant.userId !== params.forfeitedUserId) ?? null;
  if (!loser || !winner) {
    return null;
  }

  const nowMs = params.nowMs ?? Date.now();
  const winnerFinishedAt = winner.finishedAt ?? nowMs;
  const loserFinishedAt = loser.finishedAt ?? nowMs + 1;

  return {
    winner,
    loser,
    placements: [
      {
        position: 1,
        userId: winner.userId,
        username: winner.username,
        wpm: winner.wpm,
        accuracy: winner.accuracy,
        errors: winner.errors,
        timeMs: Math.max(0, winnerFinishedAt - params.match.serverStartAtMs),
      },
      {
        position: 2,
        userId: loser.userId,
        username: loser.username,
        wpm: loser.wpm,
        accuracy: loser.accuracy,
        errors: loser.errors,
        timeMs: Math.max(0, loserFinishedAt - params.match.serverStartAtMs),
      },
    ],
    message: {
      reason: "opponent_disconnected",
      message: "Your opponent has left the match.",
      finalResultsPending: true,
    },
  };
}