// Use a fully specified file name so the compiled CJS `require()` includes the extension.
import { pickLongText } from "./texts.js";
import { matchStateToLegacyStatus, type MatchLifecycleState } from "./match-fsm";

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
  // Current authoritative live match state is process-local. This is reliable for a
  // single gateway instance but not yet safe as distributed authoritative state.
  // A future phase will persist critical live transitions beyond process memory.
  state: MatchLifecycleState;
  stateChangedAt: number;
  revision: number;
  lastSnapshotBroadcastAtMs: number;
  status: "COUNTDOWN" | "RUNNING" | "FINISHED" | "ABORTED" | "PENDING";
  textSnapshot: string;
  serverStartAtMs: number;
  participants: Map<string, MatchParticipantState>; // userId -> state
  endedReason?: "completed" | "opponent_disconnected" | "aborted" | null;
  forfeitedUserId?: string | null;
  rematchMatchId?: string | null;
  finalizedAtMs?: number | null;
  cleanupScheduledAtMs?: number | null;
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
      state: "countdown",
      stateChangedAt: Date.now(),
      revision: 1,
      lastSnapshotBroadcastAtMs: 0,
      status: matchStateToLegacyStatus("countdown"),
      textSnapshot,
      serverStartAtMs: params.serverStartAtMs,
      participants,
      endedReason: null,
      forfeitedUserId: null,
      rematchMatchId: null,
      finalizedAtMs: null,
      cleanupScheduledAtMs: null,
    };

    this.matches.set(match.matchId, match);
    return match;
  }
}
