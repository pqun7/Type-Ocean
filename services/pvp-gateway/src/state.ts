import { pickFullPageText } from "./texts";
import { matchStateToLegacyStatus, type MatchLifecycleState } from "./match-fsm";
import type { MatchmakingPreference } from "./matchmaking/bands";

export type MatchInputEvent = {
  atMs: number;
  inputLength: number;
  deltaChars: number;
  wpm: number;
};

export type ConnectionUser = {
  userId: string;
  username: string;
  avatar: string | null;
  pvpRating: number;
  pvpDeviation: number;
  rankTier?: string;
  averageWpm?: number | null;
  bestWpm?: number | null;
  avgAcc?: number | null;
  matchmakingPreference?: MatchmakingPreference | null;
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
  inputEvents?: MatchInputEvent[];
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
  textId: string | null;
  inputNonce: string | null;
  serverStartAtMs: number;
  participants: Map<string, MatchParticipantState>; // userId -> state
  endedReason?: "completed" | "opponent_disconnected" | "aborted" | "no_show" | null;
  forfeitedUserId?: string | null;
  rematchMatchId?: string | null;
  finalizedAtMs?: number | null;
  cleanupScheduledAtMs?: number | null;
  reconnectUntilByUserId?: Record<string, number>;
  recentDeltas?: Array<{
    revision: number;
    type: "PROGRESS" | "MATCH_STATE";
    payload: unknown;
    atMs: number;
  }>;
  tieWindowStartedAt: number | null;
  /**
   * `true` when this is a bot-fallback match (no human found after progressive
   * search window).  ELO change is halved; XP/activity stats are unaffected.
   */
  isLowConfidence?: boolean;
};

export type QueueEntry = {
  user: ConnectionUser;
  joinedAtMs: number;
  bucketKey?: string;
  requestId?: string;
  connectionId?: string;
};

export interface IState {
  getMatch(matchId: string): MatchState | undefined;
  setMatch(match: MatchState): void;
  deleteMatch(matchId: string): void;
  getAllMatches(): IterableIterator<MatchState>;

  createLocalMatch(params: {
    matchId: string;
    roomCode: string | null;
    users: Array<ConnectionUser & { slot: number }>;
    serverStartAtMs: number;
    initialState?: MatchLifecycleState;
    textSnapshot?: string;
    textId?: string | null;
    inputNonce?: string | null;
  }): MatchState;

  getQueue(): QueueEntry[];
  addToQueue(entry: QueueEntry): void;
  removeFromQueue(userId: string): void;
  clearQueueTimeout(userId: string): void;
  setQueueTimeout(userId: string, handle: NodeJS.Timeout): void;

  clearAiInterval(matchId: string): void;
  setAiInterval(matchId: string, handle: NodeJS.Timeout): void;
}

export class InMemoryState implements IState {
  // NOTE: these were made public to support usage patterns in index.ts; this avoids repeated API refactoring.
  queue: QueueEntry[] = [];
  matches = new Map<string, MatchState>();

  // userId -> timeout handle
  queueTimeouts = new Map<string, NodeJS.Timeout>();
  // matchId -> interval handle
  aiIntervals = new Map<string, NodeJS.Timeout>();

  getMatch(matchId: string): MatchState | undefined {
    return this.matches.get(matchId);
  }

  setMatch(match: MatchState): void {
    this.matches.set(match.matchId, match);
  }

  deleteMatch(matchId: string): void {
    this.matches.delete(matchId);
  }

  getAllMatches(): IterableIterator<MatchState> {
    return this.matches.values();
  }

  getQueue(): QueueEntry[] {
    return this.queue;
  }

  addToQueue(entry: QueueEntry): void {
    this.queue.push(entry);
  }

  removeFromQueue(userId: string): void {
    this.queue = this.queue.filter((e) => e.user.userId !== userId);
  }

  clearQueueTimeout(userId: string): void {
    const t = this.queueTimeouts.get(userId);
    if (t) {
      clearTimeout(t);
      this.queueTimeouts.delete(userId);
    }
  }

  setQueueTimeout(userId: string, handle: NodeJS.Timeout): void {
    this.clearQueueTimeout(userId);
    this.queueTimeouts.set(userId, handle);
  }

  clearAiInterval(matchId: string): void {
    const t = this.aiIntervals.get(matchId);
    if (t) {
      clearInterval(t);
      this.aiIntervals.delete(matchId);
    }
  }

  setAiInterval(matchId: string, handle: NodeJS.Timeout): void {
    this.clearAiInterval(matchId);
    this.aiIntervals.set(matchId, handle);
  }

  createLocalMatch(params: {
    matchId: string;
    roomCode: string | null;
    users: Array<ConnectionUser & { slot: number }>;
    serverStartAtMs: number;
    initialState?: MatchLifecycleState;
    textSnapshot?: string;
    textId?: string | null;
    inputNonce?: string | null;
  }): MatchState {
    const textSnapshot = params.textSnapshot ?? pickFullPageText();

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
        inputEvents: [],
      });
    }

    const initialState = params.initialState ?? "countdown";

    const match: MatchState = {
      matchId: params.matchId,
      roomCode: params.roomCode,
      state: initialState,
      stateChangedAt: Date.now(),
      revision: 1,
      lastSnapshotBroadcastAtMs: 0,
      status: matchStateToLegacyStatus(initialState),
      textSnapshot,
      textId: params.textId ?? null,
      inputNonce: params.inputNonce ?? null,
      serverStartAtMs: params.serverStartAtMs,
      participants,
      endedReason: null,
      forfeitedUserId: null,
      rematchMatchId: null,
      finalizedAtMs: null,
      cleanupScheduledAtMs: null,
      reconnectUntilByUserId: {},
      recentDeltas: [],
      tieWindowStartedAt: null,
      isLowConfidence: false,
    };

    this.matches.set(match.matchId, match);
    return match;
  }
}
