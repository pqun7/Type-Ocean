// Use a fully specified file name so the compiled CJS `require()` includes the extension.
import { pickLongText } from "./texts.js";

export type ConnectionUser = {
  userId: string;
  username: string;
  avatar: string | null;
  pvpRating: number;
  pvpDeviation: number;
};

export type MatchParticipantState = {
  userId: string;
  username: string;
  avatar: string | null;
  slot: number;
  input: string;
  seq: number;
  errors: number;
  wpm: number;
  accuracy: number;
  finishedAt: number | null; // ms epoch

  // Internal anti-cheat fields (not persisted)
  lastInputAtMs?: number;
  lastInputLen?: number;
  strikes?: number;
};

export type MatchState = {
  matchId: string;
  roomCode: string | null;
  status: "COUNTDOWN" | "RUNNING" | "FINISHED";
  textSnapshot: string;
  serverStartAtMs: number;
  participants: Map<string, MatchParticipantState>; // userId -> state
};

export type QueueEntry = {
  user: ConnectionUser;
  joinedAtMs: number;
};

export class InMemoryState {
  queue: QueueEntry[] = [];
  matches = new Map<string, MatchState>();

  // userId -> timeout handle
  queueTimeouts = new Map<string, NodeJS.Timeout>();
  // matchId -> interval handle
  aiIntervals = new Map<string, NodeJS.Timeout>();

  removeFromQueue(userId: string) {
    this.queue = this.queue.filter((e) => e.user.userId !== userId);
  }

  clearQueueTimeout(userId: string) {
    const t = this.queueTimeouts.get(userId);
    if (t) {
      clearTimeout(t);
      this.queueTimeouts.delete(userId);
    }
  }

  clearAiInterval(matchId: string) {
    const t = this.aiIntervals.get(matchId);
    if (t) {
      clearInterval(t);
      this.aiIntervals.delete(matchId);
    }
  }

  createLocalMatch(params: {
    matchId: string;
    roomCode: string | null;
    users: Array<ConnectionUser & { slot: number }>;
    serverStartAtMs: number;
    textSnapshot?: string;
  }): MatchState {
    const textSnapshot = params.textSnapshot ?? pickLongText();

    const participants = new Map<string, MatchParticipantState>();
    for (const u of params.users) {
      participants.set(u.userId, {
        userId: u.userId,
        username: u.username,
        avatar: u.avatar,
        slot: u.slot,
        input: "",
        seq: 0,
        errors: 0,
        wpm: 0,
        accuracy: 100,
        finishedAt: null,

        lastInputAtMs: 0,
        lastInputLen: 0,
        strikes: 0,
      });
    }

    const match: MatchState = {
      matchId: params.matchId,
      roomCode: params.roomCode,
      status: "COUNTDOWN",
      textSnapshot,
      serverStartAtMs: params.serverStartAtMs,
      participants,
    };

    this.matches.set(match.matchId, match);
    return match;
  }
}
