import type { MatchParticipantState, MatchState } from "./state";

function serializeParticipant(participant: MatchParticipantState) {
  return {
    userId: participant.userId,
    username: participant.username,
    avatar: participant.avatar,
    slot: participant.slot,
    caretIndex: participant.input.length,
    wpm: participant.wpm,
    accuracy: participant.accuracy,
    errors: participant.errors,
    finishedAt: participant.finishedAt == null ? null : new Date(participant.finishedAt).toISOString(),
  };
}

export function bumpMatchRevision(match: MatchState) {
  match.revision += 1;
  return match.revision;
}

export function buildMatchStatePayload(match: MatchState, snapshotAtMs = Date.now()) {
  return {
    matchId: match.matchId,
    revision: match.revision,
    roomCode: match.roomCode,
    status: match.status,
    textSnapshot: match.textSnapshot,
    serverStartAt: new Date(match.serverStartAtMs).toISOString(),
    snapshotAt: new Date(snapshotAtMs).toISOString(),
    players: Array.from(match.participants.values())
      .sort((left, right) => left.slot - right.slot)
      .map(serializeParticipant),
  };
}

export function buildProgressPayload(match: MatchState, participant: MatchParticipantState, nowMs = Date.now()) {
  return {
    matchId: match.matchId,
    revision: match.revision,
    status: match.status,
    userId: participant.userId,
    caretIndex: participant.input.length,
    wpm: participant.wpm,
    accuracy: participant.accuracy,
    errors: participant.errors,
    finishedAt: participant.finishedAt == null ? null : new Date(participant.finishedAt).toISOString(),
    serverNowMs: nowMs,
  };
}

export function shouldBroadcastPeriodicMatchSnapshot(match: MatchState, nowMs: number, intervalMs: number) {
  if (intervalMs <= 0) return false;
  if (match.state !== "countdown" && match.state !== "live") return false;
  return nowMs - match.lastSnapshotBroadcastAtMs >= intervalMs;
}

export function markMatchSnapshotBroadcast(match: MatchState, nowMs = Date.now()) {
  match.lastSnapshotBroadcastAtMs = nowMs;
}