import "./load-env";

import crypto from "crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { WebSocketServer, WebSocket } from "ws";

import { toJson, type ServerMessage } from "./protocol";
import { InMemoryState, type ConnectionUser } from "./state";
import { updateElo1v1 } from "./mmr";
import { ratingFromWpm } from "./ai";
import { createTokenBucket, type TokenBucket } from "./rate-limit";
import { createRedisBus, matchChannel, roomChannel, userChannel, type RedisBus } from "./redis-bus";
import { incrementGatewayMetric, observeGatewayHistogram, setGatewayGauge } from "./metrics";
import { createGatewayEventBus } from "./events";
import { createGatewayHealthController, type GatewayHealthController } from "./health";
import { InMemoryIdempotencyStore } from "./idempotency";
import { buildDisconnectForfeitOutcome, runDisconnectForfeitSequence } from "./disconnect-forfeit";
import {
  buildQueueBucketKey,
  DEFAULT_QUEUE_BAND_CONFIG,
  getExpandedQueueRatingRange,
  normalizeMatchmakingPreference,
  type MatchmakingPreference,
} from "./matchmaking/bands";
import { createLocalLock } from "./local-lock";
import { matchStateFromDbStatus, matchStateToDbStatus, matchStateToLegacyStatus, transitionMatchState, type MatchLifecycleState } from "./match-fsm";
import { buildMatchStatePayload } from "./match-sync";
import { createMessageBatcher, isBatchableServerMessage } from "./message-batcher";
import { invalidatePvpSelfCaches } from "./pvp-rating-cache";
import { assessMatch } from "./anti-cheat/anomaly";
import { recordCheatAssessment } from "./anti-cheat/flagging";
import { clearReplayProtection, registerReplayNonce } from "./anti-cheat/replay";
import { getDisconnectForfeitPolicy, getStaleMatchAbortReason, shouldDeferDisconnectForfeitForJoin, shouldRejectDuplicateMatchTab, shouldScheduleDisconnectForfeit } from "./match-session-guards";
import { buildRoomReconnectKey, getPublicRoomStartCondition, selectNextRoomHost } from "./rooms/lifecycle";
import { selectRankedText } from "./anti-cheat/text-selection";
import { createGatewayMetrics, type GatewayMetrics } from "./observability/metrics";
import { MatchCache } from "./match-cache";
import { MatchRepository } from "./match-repository";
import { createInitialLiveState, type MatchLiveState } from "./match-live-state";
import { UserCache } from "./user-cache";
import { gatewayDb, isGatewayDbConfigured, runGatewayTransaction, type GatewayDb } from "./gateway-db";
import { recomputeParticipantStats } from "./domain/match/participant-stats";
import { MatchLockRegistry } from "./domain/match/match-lock";
import { MatchCleanupService } from "./domain/match/match-cleanup";
import { MatchAggregate } from "./domain/match/match-aggregate";
import { playerProfiles, pvpMatches, pvpParticipants, pvpRatingChanges, pvpRatings, pvpRoomMembers, pvpRooms, users } from "../../../src/db/schema";
import { sanitizeAvatarUrl, sanitizeDisplayName } from "../../../src/lib/sanitize";
import { PVP_ERROR_CODES } from "../../../src/features/pvp/shared/error-codes";
import { getPvpRankInfo } from "../../../src/features/pvp/rank";
import { type WsConn } from "./presentation/ws-conn";
import { createGatewayServer } from "./presentation/http-server";
import {
  gatewayLogDebug,
  gatewayLogError,
  gatewayLogInfo,
  gatewayLogWarn,
  isMissingPvpMatchmakingPreferenceTable,
  logMissingGatewayPreferenceTableOnce,
} from "./shared/logger";
import {
  buildQueueError,
  createInputNonce,
  extractAverageWpm,
  isAiUserId,
  toEpochMs,
} from "./shared/errors";
import { nextRoomExpiryDate } from "./shared/config";
import { setupWssConnectionHandler, type WsServerOpts, type WsServerState } from "./presentation/ws-connection";
import type { GatewayDeps } from "./application/deps";
import { InputFlushCoordinator } from "./infrastructure/input-flush-coordinator";
import { RedisQueueAdapter, LocalMemoryQueueAdapter } from "./matchmaking/queue-adapter";

// =============================================================================
// BRANDED TYPES — canonical definitions live in shared/branded-ids.ts
// =============================================================================

// Import for local use within this file and re-export so existing imports from
// "./index" continue to work during the incremental migration (Phase 3).
import { type UserId, type MatchId, type RoomCode, toUserId, toMatchId, toRoomCode } from "./shared/branded-ids";
export { type UserId, type MatchId, type RoomCode, toUserId, toMatchId, toRoomCode };

// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================

const INSTANCE_ID = process.env.PVP_INSTANCE_ID ?? crypto.randomUUID();

let redisBus: RedisBus | null = null;
let messageBatcher: ReturnType<typeof createMessageBatcher<WsConn>> | null = null;
let gatewayMetrics: GatewayMetrics | null = null;
let gatewayHealthController: GatewayHealthController | null = null;
let matchCache: MatchCache | null = null;
let connectionUserCache: UserCache<ConnectionUser> | null = null;

const WS_BATCH_FLUSH_SIZE_BUCKETS = [1, 2, 4, 8, 16, 32, 64];
const WS_MESSAGE_SIZE_BUCKETS = [64, 128, 256, 512, 1024, 2048, 4096, 8192];
const DISCONNECT_FORFEIT_GRACE_MS = envInt("PVP_DISCONNECT_FORFEIT_GRACE_MS", 35_000);
const MATCH_SESSION_SUPERSEDE_GRACE_MS = envMs("PVP_MATCH_SESSION_SUPERSEDE_GRACE_MS", 5_000);
const MATCH_RESUME_DELTA_LIMIT = envInt("PVP_MATCH_RESUME_DELTA_LIMIT", 10);
const MATCH_RESULT_RETENTION_MS = envMs("PVP_MATCH_RESULT_RETENTION_MS", 5 * 60 * 1000);
const MATCH_SWEEP_INTERVAL_MS = envMs("PVP_MATCH_SWEEP_INTERVAL_MS", 30_000);
const MATCH_MAX_COUNTDOWN_AGE_MS = envMs("PVP_MATCH_MAX_COUNTDOWN_AGE_MS", 2 * 60 * 1000);
const MATCH_MAX_LIVE_AGE_MS = envMs("PVP_MATCH_MAX_LIVE_AGE_MS", 30 * 60 * 1000);
const MATCH_NO_SHOW_TIMEOUT_MS = envMs("PVP_MATCH_NO_SHOW_TIMEOUT_MS", 40_000);
const ONLINE_KEY_PREFIX = "pvp:online:";
const ROOM_RECONNECT_GRACE_MS = envMs("PVP_ROOM_RECONNECT_GRACE_MS", 30_000);
const ROOM_SWEEP_INTERVAL_MS = envMs("PVP_ROOM_SWEEP_INTERVAL_MS", 2_000);
const PUBLIC_ROOM_AUTO_START_MS = envMs("PVP_PUBLIC_ROOM_AUTO_START_MS", 50_000);
const DEV_MODE = process.env.NODE_ENV !== "production";
const TEST_BYPASS = process.env.PVP_TEST_BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production";
const FORCE_BOT_MATCH_LOCAL = DEV_MODE && envBool("PVP_TEST_FORCE_BOT_MATCH", false);
const RANKED_MATCH_START_DELAY_MS = envMs(
  "PVP_RANKED_MATCH_START_DELAY_MS",
  FORCE_BOT_MATCH_LOCAL ? 1_200 : 3_000,
);
const ROOM_MATCH_START_DELAY_MS = envMs(
  "PVP_ROOM_MATCH_START_DELAY_MS",
  FORCE_BOT_MATCH_LOCAL ? 1_500 : 3_000,
);
const ROOM_SWEEP_LOCK_KEY = "pvp:room:sweep:lock";

const matchFinalizationLocks = new Set<MatchId>();
const matchCleanupTimers = new Map<MatchId, NodeJS.Timeout>();
const firstPlaceFinalizationTimers = new Map<string, NodeJS.Timeout>();
// participantMetricAccumulators removed: stats now recomputed from scratch on every
// INPUT_UPDATE via recomputeParticipantStats() — fixes P5 (backspace bug) + P3 (leak).

/**
 * Per-match FIFO exclusive lock registry (P4).
 * Assigned in `main()` before the WS server starts accepting connections.
 * Module-level so `finalizeMatchByDisconnectForfeit` and `abortMatchLifecycle`
 * can reach it without receiving it as a parameter.
 */
let matchLockRegistry: MatchLockRegistry | null = null;

/**
 * Centralised per-match resource disposal service (P3).
 * Assigned in `main()`.  Replaces all scattered
 * `state.matches.delete/clearAiInterval/clearMatchCache` call chains.
 */
let matchCleanupService: MatchCleanupService | null = null;

/**
 * Acquire the per-match exclusive lock, falling through without locking if
 * the registry has not been initialised yet (should never happen after `main()`
 * completes startup, but guards against edge cases during testing / shutdown).
 */
async function withMatchLock<T>(matchId: MatchId, fn: () => Promise<T>): Promise<T> {
  if (matchLockRegistry) return matchLockRegistry.withLock(matchId, fn);
  return fn();
}

const hasPvpMatchmakingPreferenceTable = { value: null as boolean | null };
const pvpMatchmakingPreferenceTableLastCheckedAt = { value: 0 };
const PVP_PREFERENCE_TABLE_RETRY_MS = 60_000;

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

interface Placement {
  position: number;
  userId: string;
  username: string;
  wpm: number;
  accuracy: number;
  errors: number;
  timeMs: number;
}

interface PendingInputUpdateBatch {
  maxSeqByUser: Map<string, number>;
  enqueuedCount: number;
  firstEnqueuedAtMs: number;
}

interface QueuedUserMeta {
  bucketKey: string;
  joinedAtMs: number;
  preference: MatchmakingPreference;
  rating: number;
}

interface MatchDelta {
  revision: number;
  type: "PROGRESS" | "MATCH_STATE";
  payload: unknown;
  atMs: number;
}

interface LocalMatch {
  matchId: MatchId;
  roomCode: RoomCode | null;
  state: MatchLifecycleState;
  stateChangedAt: number;
  revision: number;
  lastSnapshotBroadcastAtMs: number;
  status: string;
  textSnapshot: string;
  textId: string | null;
  inputNonce: string | null;
  serverStartAtMs: number;
  participants: Map<string, LocalParticipant>;
  endedReason: "completed" | "opponent_disconnected" | "aborted" | "no_show" | null;
  forfeitedUserId: string | null;
  rematchMatchId: MatchId | null;
  finalizedAtMs: number | null;
  cleanupScheduledAtMs: number | null;
  reconnectUntilByUserId: Record<string, number>;
  recentDeltas: MatchDelta[];
  tieWindowStartedAt: number | null;
}

interface LocalParticipant {
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
  lastInputAtMs?: number;
  lastInputLen?: number;
  inputEvents: InputEvent[];
}

interface InputEvent {
  atMs: number;
  inputLength: number;
  deltaChars: number;
  wpm: number;
}

// WsConn defined in presentation/ws-conn.ts — imported above.

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function envBool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

function envMs(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallbackMs;
}

// allowedOrigins, originAllowed, isLoopbackAddress, getClientIp,
// createGatewayServer, isSecureGatewayRequest — imported from ./presentation/http-server
// gatewayLog*, isMissingPvpMatchmakingPreferenceTable, logMissingGatewayPreferenceTableOnce — imported from ./shared/logger
// PvpClientVisibleError, buildQueueError, toClientErrorPayload, mapHelloAuthFailure,
// decodeJwtPayloadUnsafe, createInputNonce, isAiUserId, toEpochMs, extractAverageWpm — imported from ./shared/errors
// nextRoomExpiryDate — imported from ./shared/config

// =============================================================================
// WEBSOCKET COMMUNICATION
// =============================================================================

function sendImmediate(ws: WsConn, type: ServerMessage["type"], payload: unknown): void {
  try {
    const serialized = toJson({ type, payload });
    incrementGatewayMetric("pvp_ws_outbound_messages_total", { type, batching: "immediate" });
    gatewayMetrics?.recordWsMessage({ direction: "out", type });
    observeGatewayHistogram("pvp_ws_outbound_message_bytes", Buffer.byteLength(serialized, "utf8"), WS_MESSAGE_SIZE_BUCKETS, {
      type,
      batching: "immediate",
    });
    if (type === "ERROR") {
      gatewayLogWarn("Sending websocket ERROR message", {
        userId: ws.user?.userId ?? null,
        matchId: ws.matchId ?? null,
        payload,
      });
    }
    ws.send(serialized);
  } catch {
    // ignore
  }
}

function send(ws: WsConn, type: ServerMessage["type"], payload: unknown): void {
  if (messageBatcher && isBatchableServerMessage(type)) {
    if (type === "PROGRESS") {
      messageBatcher.enqueue(ws, {
        type,
        payload: payload as { matchId: string; userId: string } & Record<string, unknown>,
      });
      return;
    }

    messageBatcher.enqueue(ws, {
      type,
      payload: payload as { room: { code: string } } & Record<string, unknown>,
    });
    return;
  }

  sendImmediate(ws, type, payload);
}

function getAuthedSocketsForUser(wss: WebSocketServer, userId: string): WsConn[] {
  const conns: WsConn[] = [];
  const cachedSockets = matchCache?.getUserSockets(userId);
  if (!cachedSockets || cachedSockets.size === 0) return conns;

  for (const socket of cachedSockets) {
    const c = socket as WsConn;
    if (c.readyState !== WebSocket.OPEN) continue;
    conns.push(c);
  }
  return conns;
}

function sendToUser(wss: WebSocketServer, userId: string, type: ServerMessage["type"], payload: unknown): void {
  if (redisBus) {
    void redisBus.publish(userChannel(userId), { type, payload });
    return;
  }
  for (const c of getAuthedSocketsForUser(wss, userId)) {
    send(c, type, payload);
  }
}

function broadcastRoom(wss: WebSocketServer, roomCode: string, type: ServerMessage["type"], payload: unknown): void {
  if (redisBus) {
    void redisBus.publish(roomChannel(roomCode), { type, payload });
    return;
  }
  const roomSockets = matchCache?.getRoomSockets(roomCode);
  if (!roomSockets || roomSockets.size === 0) return;

  for (const socket of roomSockets) {
    const c = socket as WsConn;
    if (c.readyState !== WebSocket.OPEN) continue;
    send(c, type, payload);
  }
}

function broadcastMatch(wss: WebSocketServer, matchId: string, type: ServerMessage["type"], payload: unknown): void {
  const cachedSockets = matchCache?.getMatchSockets(matchId);
  if (cachedSockets && cachedSockets.size > 0) {
    for (const socket of cachedSockets) {
      send(socket as WsConn, type, payload);
    }
  }

  if (redisBus) {
    void redisBus.publish(matchChannel(matchId), { type, payload });
  }
}

// =============================================================================
// MATCH METRICS & PARTICIPANT TRACKING
// =============================================================================

function getDisconnectForfeitKey(matchId: string, userId: string): string {
  return `${matchId}:${userId}`;
}

// ---------------------------------------------------------------------------
// Accumulator functions removed (P5 + P3 root fix).
// getParticipantMetricKey / clearParticipantMetricAccumulator /
// clearMatchMetricAccumulators / getOrInitParticipantAccumulator /
// updateParticipantMetricsIncremental — all deleted.
//
// Stats are now computed via recomputeParticipantStats() on every keystroke.
// This is O(n ≤ 1000) per event, always correct after backspace, and requires
// no external Map — eliminating both the backspace bug and the memory leak.
// ---------------------------------------------------------------------------

// =============================================================================
// MATCH STATE MANAGEMENT
// =============================================================================

function buildLiveStateFromLocalMatch(match: LocalMatch): MatchLiveState {
  const participants: MatchLiveState["participants"] = {};

  for (const participant of match.participants.values()) {
    // Full recompute: O(n ≤ 1000). Eliminates the external accumulator Map and the
    // backspace-bug that plagued the previous incremental approach (P5 fix).
    const stats = recomputeParticipantStats(
      participant.input,
      match.textSnapshot,
      match.serverStartAtMs,
      Date.now(),
    );
    participants[participant.userId] = {
      userId: participant.userId,
      username: participant.username,
      avatar: participant.avatar,
      slot: participant.slot,
      input: participant.input,
      seq: participant.seq,
      errors: stats.errors,
      wpm: stats.wpm,
      accuracy: stats.accuracy,
      finishedAt: participant.finishedAt,
      lastInputAtMs: participant.lastInputAtMs ?? null,
      // correctChars is persisted in JSONB so it survives gateway restarts (P12 fix).
      correctChars: stats.correctChars,
      inputEvents: participant.inputEvents ?? [],
    };
  }

  return {
    state: match.state,
    stateChangedAtMs: match.stateChangedAt,
    participants,
    forfeitedUserId: match.forfeitedUserId ?? null,
    endedReason: match.endedReason ?? null,
    rematchMatchId: match.rematchMatchId ?? null,
    finalizedAtMs: match.finalizedAtMs ?? null,
    reconnectUntilByUserId: match.reconnectUntilByUserId ?? {},
    tieWindowStartedAt: match.tieWindowStartedAt ?? null,
    deltas: match.recentDeltas ?? [],
  };
}

function applyMatchTransition(params: {
  match: LocalMatch;
  nextState: MatchLifecycleState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  reason?: "completed" | "opponent_disconnected" | "aborted";
}): boolean {
  const { match, nextState, eventBus } = params;
  const from = match.state;

  try {
    const transitioned = transitionMatchState(match as unknown as Parameters<typeof transitionMatchState>[0], nextState);
    match.state = transitioned.state as MatchLifecycleState;
    match.stateChangedAt = transitioned.stateChangedAt;
    match.status = matchStateToLegacyStatus(transitioned.state as MatchLifecycleState);
  } catch {
    eventBus.emit("match:invalid-transition", {
      matchId: match.matchId,
      from,
      to: nextState,
      roomCode: match.roomCode,
      atMs: Date.now(),
    });
    return false;
  }

  const event = {
    matchId: match.matchId,
    from,
    to: nextState,
    roomCode: match.roomCode,
    atMs: match.stateChangedAt,
  };

  if (nextState === "countdown") {
    eventBus.emit("match:countdown", event);
  } else if (nextState === "live") {
    eventBus.emit("match:live", event);
  } else if (nextState === "finished") {
    eventBus.emit("match:ended", {
      ...event,
      reason: params.reason ?? "completed",
    });
    eventBus.emit("match:finished", {
      ...event,
      reason: params.reason ?? "completed",
    });
  }

  return true;
}

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

async function tryBeginMatchFinalizationWithDbLock(params: {
  db: GatewayDb;
  match: LocalMatch;
}): Promise<boolean> {
  const repository = new MatchRepository(params.db);

  return repository.withTransaction(async (tx) => {
    const locked = await repository.loadForUpdate(tx, params.match.matchId);
    if (!locked) return false;
    if (locked.status === "FINISHED" || locked.status === "ABORTED") return false;

    const lockState = locked.liveState ?? buildLiveStateFromLocalMatch(params.match);
    lockState.finalizedAtMs = Date.now();

    const acquired = await repository.tryLockFinalization(tx, {
      matchId: params.match.matchId,
      expectedRevision: locked.revision,
      instanceId: INSTANCE_ID,
      liveState: lockState,
    });

    return acquired.acquired;
  });
}

async function clearTerminalMatchLiveState(params: {
  db: GatewayDb;
  matchId: string;
  status: "FINISHED" | "ABORTED";
}): Promise<void> {
  const repository = new MatchRepository(params.db);

  await repository.withTransaction(async (tx) => {
    const locked = await repository.loadForUpdate(tx, params.matchId);
    if (!locked) return;

    await repository.clearLiveStateOnTerminal(tx, {
      matchId: params.matchId,
      expectedRevision: locked.revision,
      status: params.status,
      endedAt: new Date(),
    });
  });
}

async function transferRoomHostIfNeeded(db: GatewayDb, roomId: string): Promise<string | null> {
  const room = await db.query.pvpRooms.findFirst({
    columns: {
      id: true,
      hostUserId: true,
    },
    where: eq(pvpRooms.id, roomId),
    with: {
      members: {
        columns: {
          userId: true,
          joinedAt: true,
          readyAt: true,
          leftAt: true,
        },
        orderBy: asc(pvpRoomMembers.joinedAt),
      },
    },
  });

  if (!room) return null;

  const nextHostUserId = selectNextRoomHost(room.members, room.hostUserId);
  if (!nextHostUserId || nextHostUserId === room.hostUserId) return nextHostUserId;

  await db
    .update(pvpRooms)
    .set({ hostUserId: nextHostUserId, updatedAt: new Date() })
    .where(eq(pvpRooms.id, roomId));

  return nextHostUserId;
}

async function loadRoomStatePayload(db: GatewayDb, roomCode: string): Promise<{
  roomId: string;
  room: {
    code: string;
    status: string;
    visibility: string;
    minPlayers: number;
    maxPlayers: number;
    hostUserId: string | null;
    autoStartAt: string | null;
    expiresAt: string | null;
    members: Array<{
      userId: string;
      username: string;
      avatar: string | null;
      slot: number;
      ready: boolean;
      joinedAt: Date;
      leftAt: Date | null;
    }>;
  };
} | null> {
  const room = await db.query.pvpRooms.findFirst({
    columns: {
      id: true,
      code: true,
      status: true,
      visibility: true,
      minPlayers: true,
      maxPlayers: true,
      hostUserId: true,
      autoStartAt: true,
      expiresAt: true,
    },
    where: eq(pvpRooms.code, roomCode),
    with: {
      members: {
        columns: {
          userId: true,
          colorSlot: true,
          readyAt: true,
          joinedAt: true,
          leftAt: true,
        },
        where: isNull(pvpRoomMembers.leftAt),
        orderBy: asc(pvpRoomMembers.joinedAt),
        with: {
          user: {
            columns: {
              username: true,
            },
            with: {
              profile: {
                columns: {
                  avatar: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!room) return null;

  return {
    roomId: room.id,
    room: {
      code: room.code,
      status: room.status,
      visibility: room.visibility,
      minPlayers: room.minPlayers,
      maxPlayers: room.maxPlayers,
      hostUserId: room.hostUserId,
      autoStartAt: room.autoStartAt?.toISOString() ?? null,
      expiresAt: room.expiresAt?.toISOString() ?? null,
      members: room.members.map((member) => ({
        userId: member.userId,
        username: sanitizeDisplayName(member.user.username, 32) || "user",
        avatar: sanitizeAvatarUrl(member.user.profile?.avatar ?? null),
        slot: member.colorSlot,
        ready: !!member.readyAt,
        joinedAt: member.joinedAt,
        leftAt: member.leftAt,
      })),
    },
  };
}

async function broadcastRoomState(db: GatewayDb, wss: WebSocketServer, roomCode: string): Promise<{ roomId: string; room: { code: string; status: string; visibility: string; minPlayers: number; maxPlayers: number; hostUserId: string | null; autoStartAt: string | null; expiresAt: string | null; members: Array<{ userId: string; username: string; avatar: string | null; slot: number; ready: boolean; }> } } | null> {
  const payload = await loadRoomStatePayload(db, roomCode);
  if (!payload) return null;

  broadcastRoom(wss, roomCode, "ROOM_STATE", {
    room: {
      code: payload.room.code,
      status: payload.room.status,
      visibility: payload.room.visibility,
      minPlayers: payload.room.minPlayers,
      maxPlayers: payload.room.maxPlayers,
      hostUserId: payload.room.hostUserId,
      autoStartAt: payload.room.autoStartAt,
      expiresAt: payload.room.expiresAt,
      members: payload.room.members.map((member) => ({
        userId: member.userId,
        username: member.username,
        avatar: member.avatar,
        slot: member.slot,
        ready: member.ready,
      })),
    },
  });

  return payload;
}

// =============================================================================
// MATCH FINALIZATION HELPERS
// =============================================================================

function tryBeginMatchFinalization(matchId: MatchId): boolean {
  if (matchFinalizationLocks.has(matchId)) return false;
  matchFinalizationLocks.add(matchId);
  return true;
}

function endMatchFinalization(matchId: MatchId): void {
  matchFinalizationLocks.delete(matchId);
}

async function runWithMatchFinalizationLock(matchId: MatchId, work: () => Promise<void>): Promise<boolean> {
  if (!tryBeginMatchFinalization(matchId)) return false;
  try {
    await work();
    return true;
  } finally {
    endMatchFinalization(matchId);
  }
}

function clearScheduledMatchCleanup(matchId: MatchId): void {
  const existing = matchCleanupTimers.get(matchId);
  if (!existing) return;
  clearTimeout(existing);
  matchCleanupTimers.delete(matchId);
}

function scheduleMatchCleanup(state: InMemoryState, matchId: MatchId, delayMs = MATCH_RESULT_RETENTION_MS): void {
  clearScheduledMatchCleanup(matchId);
  const match = state.matches.get(matchId) as LocalMatch | undefined;
  if (!match) return;

  match.cleanupScheduledAtMs = Date.now() + delayMs;
  const timer = setTimeout(() => {
    // MatchCleanupService.dispose handles all 11 per-match resource releases
    // atomically (timer, locks, timers, sets, maps, cache, state entry).
    matchCleanupService?.dispose(matchId);
  }, delayMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  matchCleanupTimers.set(matchId, timer);
}

// =============================================================================
// ROOM LIFECYCLE
// =============================================================================

async function tryAcquireRoomSweepLock(): Promise<boolean> {
  const redis = redisBus?.redis ?? null;
  if (!redis) return true;
  const token = `${INSTANCE_ID}:${Date.now()}`;
  const acquired = await redis.set(ROOM_SWEEP_LOCK_KEY, token, "EX", 10, "NX");
  return acquired === "OK";
}

async function sweepRoomLifecycle(
  db: GatewayDb,
  wss: WebSocketServer,
  onPublicRoomReady?: (roomCode: string) => Promise<unknown>
): Promise<void> {
  const redis = redisBus?.redis ?? null;
  const acquired = await tryAcquireRoomSweepLock();
  if (!acquired) return;

  const now = Date.now();
  const rooms = await db.query.pvpRooms.findMany({
    columns: {
      id: true,
      code: true,
      visibility: true,
      expiresAt: true,
      status: true,
    },
    where: or(eq(pvpRooms.status, "OPEN"), lte(pvpRooms.expiresAt, new Date(now))),
    with: {
      members: {
        columns: {
          userId: true,
          joinedAt: true,
          readyAt: true,
          leftAt: true,
        },
        orderBy: asc(pvpRoomMembers.joinedAt),
      },
    },
  });

  for (const room of rooms) {
    const roomMembers = room.members;

    if (room.expiresAt && room.expiresAt.getTime() <= now) {
      broadcastRoom(wss, room.code, "ERROR", { message: "Room expired" });
      try {
        await db.delete(pvpRooms).where(eq(pvpRooms.id, room.id));
      } catch (error) {
        gatewayLogError("Failed to delete expired room", error, {
          roomId: room.id,
          roomCode: room.code,
        });
        throw error;
      }
      continue;
    }

    let changed = false;
    for (const member of roomMembers) {
      if (member.leftAt) continue;
      const reconnectKey = buildRoomReconnectKey(room.id, member.userId);
      const hasReconnectLease = redis ? (await redis.exists(reconnectKey)) === 1 : false;
      const isOnline = redis ? (await redis.exists(`${ONLINE_KEY_PREFIX}${member.userId}`)) === 1 : getAuthedSocketsForUser(wss, member.userId).length > 0;
      if (isOnline || hasReconnectLease) continue;

      await db
        .update(pvpRoomMembers)
        .set({ leftAt: new Date() })
        .where(and(eq(pvpRoomMembers.roomId, room.id), eq(pvpRoomMembers.userId, member.userId)));

      changed = true;
    }

    if (changed) {
      await transferRoomHostIfNeeded(db, room.id);
      await broadcastRoomState(db, wss, room.code);
    }

    if (room.visibility === "PUBLIC") {
      await onPublicRoomReady?.(room.code);
    }
  }
}

async function restoreRoomAfterMatch(db: GatewayDb, wss: WebSocketServer, roomCode: string): Promise<void> {
  const roomRows = await db
    .select({
      id: pvpRooms.id,
      code: pvpRooms.code,
      status: pvpRooms.status,
      visibility: pvpRooms.visibility,
      maxPlayers: pvpRooms.maxPlayers,
    })
    .from(pvpRooms)
    .where(eq(pvpRooms.code, roomCode))
    .limit(1);

  const room = roomRows[0] ?? null;
  if (!room) return;

  await runGatewayTransaction(db, async (tx) => {
    await tx
      .update(pvpRooms)
      .set({
        status: "OPEN",
        autoStartAt: room.visibility === "PUBLIC" ? new Date(Date.now() + PUBLIC_ROOM_AUTO_START_MS) : null,
        expiresAt: nextRoomExpiryDate(),
        updatedAt: new Date(),
      })
      .where(eq(pvpRooms.id, room.id));

    await tx
      .update(pvpRoomMembers)
      .set({ readyAt: null })
      .where(and(eq(pvpRoomMembers.roomId, room.id), isNull(pvpRoomMembers.leftAt)));
  });

  await broadcastRoomState(db, wss, roomCode);
}

// =============================================================================
// MATCH FINALIZATION
// =============================================================================

async function finalizeMatchResults(params: {
  db: GatewayDb;
  wss: WebSocketServer;
  state: InMemoryState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  matchId: string;
  placements: Placement[];
  reason: "completed" | "opponent_disconnected" | "aborted";
}): Promise<void> {
  const match = params.state.matches.get(params.matchId) as LocalMatch | undefined;
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;

  const dbLock = await tryBeginMatchFinalizationWithDbLock({
    db: params.db,
    match,
  });
  if (!dbLock) return;

  gatewayLogInfo("Finalizing match results", {
    matchId: params.matchId,
    reason: params.reason,
    participants: params.placements.length,
  });

  match.endedReason = params.reason;
  applyMatchTransition({
    match,
    nextState: "finished",
    eventBus: params.eventBus,
    reason: params.reason,
  });
  params.state.clearAiInterval(match.matchId);

  await params.db
    .update(pvpMatches)
    .set({
      status: matchStateToDbStatus("finished"),
      startedAt: new Date(match.serverStartAtMs),
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pvpMatches.id, match.matchId));

  await Promise.all(
    params.placements
      .filter((placement) => !isAiUserId(placement.userId))
      .map(async (placement) => {
        try {
          await params.db
            .update(pvpParticipants)
            .set({
              finalWpm: placement.wpm,
              finalAccuracy: placement.accuracy,
              finalErrors: placement.errors,
              timeSpentSec: Math.max(0, Math.floor(placement.timeMs / 1000)),
              completedAt: new Date(match.serverStartAtMs + placement.timeMs),
              ...(params.reason === "opponent_disconnected" && match.forfeitedUserId === placement.userId
                ? { disconnectCount: sql`${pvpParticipants.disconnectCount} + 1` }
                : {}),
            })
            .where(and(eq(pvpParticipants.matchId, match.matchId), eq(pvpParticipants.userId, placement.userId)));
        } catch (error) {
          gatewayLogError("Failed to persist participant final stats", error, {
            matchId: match.matchId,
            userId: placement.userId,
            reason: params.reason,
          });
          throw error;
        }
      })
  );

  let ratingChanges: Array<{ userId: string; before: number; after: number; delta: number }> = [];

  const ai = params.placements.find((p) => isAiUserId(p.userId)) ?? null;
  const humans = params.placements.filter((p) => !isAiUserId(p.userId));

  if (match.roomCode === null && params.placements.length === 2 && humans.length === 1 && ai) {
    const humanId = humans[0]!.userId;
    const humanWon = params.placements[0]!.userId === humanId;

    await params.db
      .insert(pvpRatings)
      .values({ userId: humanId })
      .onConflictDoNothing({ target: pvpRatings.userId });

    const humanRows = await params.db
      .select({ rating: pvpRatings.rating, deviation: pvpRatings.deviation })
      .from(pvpRatings)
      .where(eq(pvpRatings.userId, humanId))
      .limit(1);

    const humanRow = humanRows[0];
    if (!humanRow) {
      throw new Error(`Missing rating row for user ${humanId}`);
    }

    const aiRating = ratingFromWpm(ai.wpm);
    const upd = updateElo1v1({
      a: { rating: humanRow.rating, deviation: humanRow.deviation },
      b: { rating: aiRating, deviation: 180 },
      aScore: humanWon ? 1 : 0,
    });
    
    await runGatewayTransaction(params.db, async (tx) => {
      await tx.execute(sql`SAVEPOINT pvp_rating_updates`);
      try {
        await tx
          .update(pvpRatings)
          .set({
            rating: upd.nextA.rating,
            deviation: upd.nextA.deviation,
            gamesPlayed: sql`${pvpRatings.gamesPlayed} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(pvpRatings.userId, humanId));

        await tx.insert(pvpRatingChanges).values({
          matchId: match.matchId,
          userId: humanId,
          beforeRating: humanRow.rating,
          afterRating: upd.nextA.rating,
          delta: upd.deltaA,
        });

        await tx.execute(sql`RELEASE SAVEPOINT pvp_rating_updates`);
      } catch (error) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT pvp_rating_updates`);
        gatewayLogError("Failed to persist rating update (human vs AI)", error, {
          matchId: match.matchId,
          userId: humanId,
        });
        throw error;
      }
    });

    ratingChanges = [{ userId: humanId, before: humanRow.rating, after: upd.nextA.rating, delta: upd.deltaA }];
  } else if (match.roomCode === null && params.placements.length === 2 && humans.length === 2) {
    const winnerId = params.placements[0]!.userId;
    const loserId = params.placements[1]!.userId;

    await Promise.all([
      params.db.insert(pvpRatings).values({ userId: winnerId }).onConflictDoNothing({ target: pvpRatings.userId }),
      params.db.insert(pvpRatings).values({ userId: loserId }).onConflictDoNothing({ target: pvpRatings.userId }),
    ]);

    const [winnerRows, loserRows] = await Promise.all([
      params.db
        .select({ rating: pvpRatings.rating, deviation: pvpRatings.deviation })
        .from(pvpRatings)
        .where(eq(pvpRatings.userId, winnerId))
        .limit(1),
      params.db
        .select({ rating: pvpRatings.rating, deviation: pvpRatings.deviation })
        .from(pvpRatings)
        .where(eq(pvpRatings.userId, loserId))
        .limit(1),
    ]);

    const winnerRow = winnerRows[0];
    const loserRow = loserRows[0];
    if (!winnerRow || !loserRow) {
      throw new Error("Missing rating rows for winner/loser");
    }

    const upd = updateElo1v1({
      a: { rating: winnerRow.rating, deviation: winnerRow.deviation },
      b: { rating: loserRow.rating, deviation: loserRow.deviation },
      aScore: 1,
    });

    await runGatewayTransaction(params.db, async (tx) => {
      await tx.execute(sql`SAVEPOINT pvp_rating_updates`);
      try {
        await tx
          .update(pvpRatings)
          .set({
            rating: upd.nextA.rating,
            deviation: upd.nextA.deviation,
            gamesPlayed: sql`${pvpRatings.gamesPlayed} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(pvpRatings.userId, winnerId));

        await tx
          .update(pvpRatings)
          .set({
            rating: upd.nextB.rating,
            deviation: upd.nextB.deviation,
            gamesPlayed: sql`${pvpRatings.gamesPlayed} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(pvpRatings.userId, loserId));

        await tx
          .insert(pvpRatingChanges)
          .values([
            {
              matchId: match.matchId,
              userId: winnerId,
              beforeRating: winnerRow.rating,
              afterRating: upd.nextA.rating,
              delta: upd.deltaA,
            },
            {
              matchId: match.matchId,
              userId: loserId,
              beforeRating: loserRow.rating,
              afterRating: upd.nextB.rating,
              delta: upd.deltaB,
            },
          ])
          .onConflictDoNothing({ target: [pvpRatingChanges.matchId, pvpRatingChanges.userId] });

        await tx.execute(sql`RELEASE SAVEPOINT pvp_rating_updates`);
      } catch (error) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT pvp_rating_updates`);
        gatewayLogError("Failed to persist rating update (human vs human)", error, {
          matchId: match.matchId,
          winnerId,
          loserId,
        });
        throw error;
      }
    });

    ratingChanges = [
      { userId: winnerId, before: winnerRow.rating, after: upd.nextA.rating, delta: upd.deltaA },
      { userId: loserId, before: loserRow.rating, after: upd.nextB.rating, delta: upd.deltaB },
    ];
  }

  for (const participant of match.participants.values()) {
    if (isAiUserId(participant.userId)) continue;

    const assessment = await assessMatch(match.matchId, participant.userId, participant.inputEvents ?? [], {
      isBot: isAiUserId(participant.userId),
      redis: redisBus?.redis ?? null,
    });

    await recordCheatAssessment({
      db: params.db,
      userId: participant.userId,
      matchId: match.matchId,
      confidence: assessment.confidence,
      flags: assessment.flags,
      redis: redisBus?.redis ?? null,
      metadata: {
        resultReason: params.reason,
        textId: match.textId,
        revision: match.revision,
      },
    });
  }

  broadcastMatch(params.wss, match.matchId, "RESULTS", {
    matchId: match.matchId,
    placements: params.placements,
    ratingChanges,
  });

  for (const change of ratingChanges) {
    connectionUserCache?.invalidate(change.userId);
  }

  await invalidatePvpSelfCaches(
    redisBus?.redis ?? null,
    ratingChanges.map((change) => change.userId)
  );

  await clearReplayProtection(
    redisBus?.redis ?? null,
    match.matchId,
    Array.from(match.participants.values())
      .filter((participant) => !isAiUserId(participant.userId))
      .map((participant) => participant.userId)
  );

  match.finalizedAtMs = Date.now();
  await clearTerminalMatchLiveState({
    db: params.db,
    matchId: match.matchId,
    status: "FINISHED",
  });
  matchCache?.clearMatch(match.matchId);
  scheduleMatchCleanup(params.state, match.matchId);

  if (match.roomCode) {
    await restoreRoomAfterMatch(params.db, params.wss, match.roomCode);
  }
}

async function finalizeMatchByDisconnectForfeit(params: {
  db: GatewayDb;
  wss: WebSocketServer;
  state: InMemoryState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  matchId: string;
  forfeitedUserId: string;
}): Promise<void> {
  const match = params.state.matches.get(params.matchId) as LocalMatch | undefined;
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;
  await runWithMatchFinalizationLock(toMatchId(params.matchId), async () => {
    const outcome = buildDisconnectForfeitOutcome({
      match: match as unknown as Parameters<typeof buildDisconnectForfeitOutcome>[0]["match"],
      forfeitedUserId: params.forfeitedUserId,
    });
    if (!outcome) return;

    gatewayLogWarn("Applying disconnect forfeit", {
      matchId: params.matchId,
      forfeitedUserId: params.forfeitedUserId,
    });

    const nowMs = Date.now();
    if (outcome.winner.finishedAt == null) outcome.winner.finishedAt = nowMs;
    if (outcome.loser.finishedAt == null) outcome.loser.finishedAt = nowMs + 1;
    match.forfeitedUserId = outcome.loser.userId;
    match.endedReason = "opponent_disconnected";

    await runDisconnectForfeitSequence({
      sendMatchEnded: () => {
        sendToUser(params.wss, outcome.winner.userId, "MATCH_ENDED", {
          matchId: match.matchId,
          ...outcome.message,
        });
      },
      finalizeResults: () =>
        finalizeMatchResults({
          db: params.db,
          wss: params.wss,
          state: params.state,
          eventBus: params.eventBus,
          matchId: params.matchId,
          placements: outcome.placements,
          reason: "opponent_disconnected",
        }),
    });
  });
}

async function abortMatchLifecycle(params: {
  db: GatewayDb;
  wss: WebSocketServer;
  state: InMemoryState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  matchId: string;
  reasonMessage: string;
  reasonCode?: "aborted" | "no_show";
}): Promise<void> {
  const match = params.state.matches.get(params.matchId) as LocalMatch | undefined;
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;
  await runWithMatchFinalizationLock(toMatchId(params.matchId), async () => {
    const dbLock = await tryBeginMatchFinalizationWithDbLock({
      db: params.db,
      match,
    });
    if (!dbLock) return;

    const reasonCode = params.reasonCode ?? "aborted";
    match.endedReason = reasonCode;
    const transitioned = applyMatchTransition({
      match,
      nextState: "aborted",
      eventBus: params.eventBus,
      reason: "aborted",
    });
    if (!transitioned) return;

    params.state.clearAiInterval(match.matchId);

    await params.db
      .update(pvpMatches)
      .set({
        status: matchStateToDbStatus("aborted"),
        startedAt: reasonCode === "no_show" ? null : new Date(match.serverStartAtMs),
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pvpMatches.id, match.matchId));

    for (const participant of match.participants.values()) {
      if (isAiUserId(participant.userId)) continue;
      sendToUser(params.wss, participant.userId, "MATCH_ENDED", {
        matchId: match.matchId,
        reason: reasonCode,
        message: params.reasonMessage,
        finalResultsPending: false,
      });
    }

    await clearReplayProtection(
      redisBus?.redis ?? null,
      match.matchId,
      Array.from(match.participants.values())
        .filter((participant) => !isAiUserId(participant.userId))
        .map((participant) => participant.userId)
    );

    match.finalizedAtMs = Date.now();
    await clearTerminalMatchLiveState({
      db: params.db,
      matchId: match.matchId,
      status: "ABORTED",
    });
    matchCache?.clearMatch(match.matchId);
    scheduleMatchCleanup(params.state, match.matchId);

    if (match.roomCode) {
      await restoreRoomAfterMatch(params.db, params.wss, match.roomCode);
    }
  });
}

// =============================================================================
// PLAYER PAYLOAD BUILDER
// =============================================================================

function buildMatchFoundPlayerPayload(user: ConnectionUser & { slot: number }): {
  userId: string;
  username: string;
  avatar: string | null;
  slot: number;
  rating: number;
  rankTier: string;
  averageWpm: number | null;
} {
  return {
    userId: user.userId,
    username: user.username,
    avatar: user.avatar,
    slot: user.slot,
    rating: user.pvpRating,
    rankTier: user.rankTier ?? "unrated",
    averageWpm: user.averageWpm ?? null,
  };
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

async function main(): Promise<void> {
  const PORT = envInt("PORT", 8787);
  const db: GatewayDb = gatewayDb;
  const matchRepository = new MatchRepository(db);
  const state = new InMemoryState();
  matchCache = new MatchCache();
  const eventBus = createGatewayEventBus();
  const localQueueLock = createLocalLock();
  const matchJoinLock = createLocalLock();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const disconnectForfeitTimers = new Map<string, NodeJS.Timeout>();
  const rematchStartedByMatchId = new Set<string>();
  const USER_CACHE_TTL_MS = envMs("PVP_USER_CACHE_TTL_MS", 30_000);
  const USER_CACHE_MAX_ENTRIES = envInt("PVP_USER_CACHE_MAX_ENTRIES", 5_000);
  connectionUserCache = new UserCache<ConnectionUser>({
    ttlMs: USER_CACHE_TTL_MS,
    maxEntries: USER_CACHE_MAX_ENTRIES,
  });

  gatewayLogInfo("Starting PvP gateway", {
    port: PORT,
    environment: process.env.NODE_ENV ?? "development",
    instanceId: INSTANCE_ID,
  });

  const WS_PING_INTERVAL_MS = envInt("PVP_WS_PING_INTERVAL_MS", 15_000);
  const DEV = process.env.NODE_ENV !== "production";
  const TEST_FORCE_BOT_MATCH = DEV && envBool("PVP_TEST_FORCE_BOT_MATCH", false);
  const AI_QUEUE_TIMEOUT_MS = envMs("PVP_AI_QUEUE_TIMEOUT_MS", TEST_FORCE_BOT_MATCH ? 2_000 : 8_000);
  const ENABLE_PROMETHEUS_METRICS = envBool("PVP_PROMETHEUS_METRICS_ENABLED", true);
  const WS_SOFT_CONNECTION_LIMIT = envInt("PVP_WS_SOFT_CONNECTION_LIMIT", 1_000);
  const SHUTDOWN_GRACE_MS = envMs("PVP_GRACEFUL_SHUTDOWN_TIMEOUT_MS", 30_000);
  const USE_REDIS = envBool("PVP_USE_REDIS", false);
  const REDIS_URL = process.env.PVP_REDIS_URL ?? process.env.REDIS_URL ?? null;
  const INPUT_UPDATE_FLUSH_INTERVAL_MS = envMs("PVP_INPUT_UPDATE_FLUSH_INTERVAL_MS", 100);
  const INPUT_UPDATE_FLUSH_MAX_ENQUEUED = envInt("PVP_INPUT_UPDATE_FLUSH_MAX_ENQUEUED", 32);

  const getActiveMatchCount = (): number => {
    let activeMatches = 0;
    for (const match of state.matches.values()) {
      const m = match as LocalMatch;
      if (m.state === "finished" || m.state === "aborted") continue;
      activeMatches += 1;
    }
    return activeMatches;
  };

  gatewayMetrics = createGatewayMetrics({
    enableMetrics: ENABLE_PROMETHEUS_METRICS,
    gateway: "pvp-gateway",
    instanceId: INSTANCE_ID,
  });
  gatewayHealthController = createGatewayHealthController({
    instanceId: INSTANCE_ID,
    db,
    getRedisClient: () => redisBus?.redis ?? null,
    getConnectionCount: () => wss?.clients.size ?? 0,
    getActiveMatchCount,
    wsSoftConnectionLimit: WS_SOFT_CONNECTION_LIMIT,
    redisRequired: USE_REDIS,
  });
  gatewayHealthController.markReady();
  gatewayMetrics.setLifecycle({
    ready: gatewayHealthController.isReady(),
    draining: gatewayHealthController.isDraining(),
  });

  eventBus.on("match:finished", ({ reason }: { reason: string }) => {
    if (reason === "opponent_disconnected") {
      gatewayMetrics?.incrementMatchResult("abandon");
      return;
    }
    if (reason === "aborted") {
      gatewayMetrics?.incrementMatchResult("timeout");
    }
  });

  const server = createGatewayServer({
    getGatewayMetrics: () => gatewayMetrics,
    getHealthController: () => gatewayHealthController,
  });

  const WS_MAX_PAYLOAD_BYTES = envInt("PVP_WS_MAX_PAYLOAD_BYTES", 64 * 1024);
  const WS_MAX_MSG_PER_SEC = envInt("PVP_WS_MAX_MSG_PER_SEC", 40);
  const WS_MAX_MSG_BURST = envInt("PVP_WS_MAX_MSG_BURST", 80);
  const WS_MAX_INPUT_MSG_PER_SEC = envInt("PVP_WS_MAX_INPUT_MSG_PER_SEC", 25);
  const WS_MAX_INPUT_MSG_BURST = envInt("PVP_WS_MAX_INPUT_MSG_BURST", 50);
  const LOCAL_RELAXED_WS_LIMITS = envBool("PVP_WS_LOCAL_RELAXED_LIMITS", DEV);
  const localMinConnectionsPerIp = TEST_FORCE_BOT_MATCH ? 400 : 200;
  const localMinAttemptsPerMin = TEST_FORCE_BOT_MATCH ? 12_000 : 4_000;
  const localMinAttemptsBurst = TEST_FORCE_BOT_MATCH ? 2_000 : 600;
  const configuredWsMaxConnectionsPerIp = envInt(
    "PVP_WS_MAX_CONNECTIONS_PER_IP",
    TEST_FORCE_BOT_MATCH || LOCAL_RELAXED_WS_LIMITS ? 400 : 5,
  );
  const configuredWsConnectionAttemptsPerMin = envInt(
    "PVP_WS_CONNECTION_ATTEMPTS_PER_MIN",
    TEST_FORCE_BOT_MATCH || LOCAL_RELAXED_WS_LIMITS ? 12_000 : 20,
  );
  const configuredWsConnectionAttemptsBurst = envInt(
    "PVP_WS_CONNECTION_ATTEMPTS_BURST",
    TEST_FORCE_BOT_MATCH || LOCAL_RELAXED_WS_LIMITS ? 2_000 : 10,
  );
  const WS_MAX_CONNECTIONS_PER_IP = LOCAL_RELAXED_WS_LIMITS
    ? Math.max(configuredWsMaxConnectionsPerIp, localMinConnectionsPerIp)
    : configuredWsMaxConnectionsPerIp;
  const WS_CONNECTION_ATTEMPTS_PER_MIN = LOCAL_RELAXED_WS_LIMITS
    ? Math.max(configuredWsConnectionAttemptsPerMin, localMinAttemptsPerMin)
    : configuredWsConnectionAttemptsPerMin;
  const WS_CONNECTION_ATTEMPTS_BURST = LOCAL_RELAXED_WS_LIMITS
    ? Math.max(configuredWsConnectionAttemptsBurst, localMinAttemptsBurst)
    : configuredWsConnectionAttemptsBurst;
  const WS_GLOBAL_CONNECTIONS_PER_SEC = envInt("PVP_WS_GLOBAL_CONNECTIONS_PER_SEC", 0);
  const WS_GLOBAL_CONNECTIONS_BURST = envInt("PVP_WS_GLOBAL_CONNECTIONS_BURST", 200);
  const ALLOW_PARTICIPANT_PERSIST_FALLBACK = DEV && envBool("PVP_ALLOW_PARTICIPANT_PERSIST_FALLBACK", true);
  const WS_TICK_MS = envMs("PVP_WS_TICK_MS", 60);
  const MATCH_SNAPSHOT_INTERVAL_MS = envMs("PVP_MATCH_SNAPSHOT_INTERVAL_MS", 2_000);
  const ROOM_ACTION_COOLDOWN_MS = envMs("PVP_ROOM_ACTION_COOLDOWN_MS", 2_000);
  const CONNECTION_SPIKE_ALERT_THRESHOLD = envInt("PVP_WS_CONNECTION_SPIKE_ALERT_THRESHOLD", 30);
  const METRIC_SNAPSHOT_INTERVAL_MS = envMs("PVP_METRIC_SNAPSHOT_INTERVAL_MS", 5_000);

  gatewayLogInfo("Gateway runtime tuning", {
    testForceBotMatch: TEST_FORCE_BOT_MATCH,
    localRelaxedWsLimits: LOCAL_RELAXED_WS_LIMITS,
    aiQueueTimeoutMs: AI_QUEUE_TIMEOUT_MS,
    rankedMatchStartDelayMs: RANKED_MATCH_START_DELAY_MS,
    wsMaxConnectionsPerIp: WS_MAX_CONNECTIONS_PER_IP,
    wsConnectionAttemptsPerMin: WS_CONNECTION_ATTEMPTS_PER_MIN,
    allowParticipantPersistFallback: ALLOW_PARTICIPANT_PERSIST_FALLBACK,
  });

  const wss = new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD_BYTES });
  messageBatcher = createMessageBatcher<WsConn>({
    tickMs: WS_TICK_MS,
    isOpen: (socket) => socket.readyState === WebSocket.OPEN,
    onFlush: ({ messages }) => {
      observeGatewayHistogram("pvp_ws_batch_flush_size", messages.length, WS_BATCH_FLUSH_SIZE_BUCKETS);
      for (const message of messages) {
        incrementGatewayMetric("pvp_ws_outbound_messages_total", { type: message.type, batching: "batched" });
        gatewayMetrics?.recordWsMessage({ direction: "out", type: message.type });
      }
    },
  });
  const activeConnectionsByIp = new Map<string, number>();
  const connectionAttemptBuckets = new Map<string, TokenBucket>();
  const globalConnectionBucket =
    WS_GLOBAL_CONNECTIONS_PER_SEC > 0
      ? createTokenBucket({
          capacity: WS_GLOBAL_CONNECTIONS_BURST,
          refillPerSec: WS_GLOBAL_CONNECTIONS_PER_SEC,
          nowMs: Date.now(),
        })
      : null;
  const roomActionLastSeen = new Map<string, number>();
  const activeMatchSessions = new Map<string, WsConn>();
  const inFlightMatchJoins = new Map<string, number>();
  const noShowTimers = new Map<string, NodeJS.Timeout>();
  const pendingInputUpdatesByMatch = new Map<string, PendingInputUpdateBatch>();
  const inputUpdateFlushRetriesByMatch = new Map<string, number>();

  // -------------------------------------------------------------------------
  // P4: Per-match FIFO lock registry — eliminates concurrency races
  // P3: Centralised cleanup service — fixes all remaining memory leaks
  // -------------------------------------------------------------------------
  matchLockRegistry = new MatchLockRegistry();
  matchCleanupService = new MatchCleanupService(
    matchFinalizationLocks,
    matchCleanupTimers,
    matchCache,
    state,
    noShowTimers,
    disconnectForfeitTimers,
    rematchStartedByMatchId,
    pendingInputUpdatesByMatch,
    inputUpdateFlushRetriesByMatch,
    matchLockRegistry,
  );
  // MatchAggregate: Command Bus + Aggregate Root (P2/P4).
  // Phase 2 uses withMatchLock() directly at call sites for minimal diff.
  // Phase 3 will migrate full handler logic into this aggregate.
  const matchAggregate = new MatchAggregate(matchLockRegistry, {
    inputUpdate: async () => {
      // Phase 3 migration target: INPUT_UPDATE mutation block from ws handler.
    },
    startCountdown: async () => {
      // Phase 3 migration target: DB-first serverStartAtMs write.
    },
    finalizeComplete: async () => {
      // Phase 3 migration target: delegate to finalizeMatchResults inside lock.
    },
    abort: async () => {
      // Phase 3 migration target: delegate to abortMatchLifecycle inside lock.
    },
  });
  // Silence unused-variable lint; the aggregate is exercised via tests today
  // and will be wired into hot paths during Phase 3.
  void matchAggregate;
  const INPUT_UPDATE_FLUSH_MAX_RETRIES = envInt("PVP_INPUT_UPDATE_FLUSH_MAX_RETRIES", 8);
  const DISCONNECT_FORFEIT_JOIN_DEFER_MS = envMs("PVP_DISCONNECT_FORFEIT_JOIN_DEFER_MS", 500);

  const getMatchJoinSessionKey = (matchId: string, userId: string): string => `${matchId}:${userId}`;

  const beginMatchJoinInFlight = (matchId: string, userId: string): void => {
    const key = getMatchJoinSessionKey(matchId, userId);
    const next = (inFlightMatchJoins.get(key) ?? 0) + 1;
    inFlightMatchJoins.set(key, next);
  };

  const endMatchJoinInFlight = (matchId: string, userId: string): void => {
    const key = getMatchJoinSessionKey(matchId, userId);
    const next = (inFlightMatchJoins.get(key) ?? 0) - 1;
    if (next > 0) {
      inFlightMatchJoins.set(key, next);
      return;
    }
    inFlightMatchJoins.delete(key);
  };

  const isMatchJoinInFlight = (matchId: string, userId: string): boolean => {
    return (inFlightMatchJoins.get(getMatchJoinSessionKey(matchId, userId)) ?? 0) > 0;
  };

  const getPendingInputQueueStats = (): { pendingMatches: number; totalEnqueued: number; oldestAgeMs: number } => {
    const nowMs = Date.now();
    let totalEnqueued = 0;
    let oldestAgeMs = 0;

    for (const batch of pendingInputUpdatesByMatch.values()) {
      totalEnqueued += batch.enqueuedCount;
      oldestAgeMs = Math.max(oldestAgeMs, nowMs - batch.firstEnqueuedAtMs);
    }

    return {
      pendingMatches: pendingInputUpdatesByMatch.size,
      totalEnqueued,
      oldestAgeMs,
    };
  };

  const enqueueInputUpdateBatch = (matchId: string, userId: string, seq: number): void => {
    const nowMs = Date.now();
    const existing = pendingInputUpdatesByMatch.get(matchId);
    if (!existing) {
      pendingInputUpdatesByMatch.set(matchId, {
        maxSeqByUser: new Map([[userId, seq]]),
        enqueuedCount: 1,
        firstEnqueuedAtMs: nowMs,
      });
      return;
    }

    const previousSeq = existing.maxSeqByUser.get(userId);
    if (previousSeq == null || seq > previousSeq) {
      existing.maxSeqByUser.set(userId, seq);
    }
    existing.enqueuedCount += 1;
  };

  const mergePendingInputBatch = (matchId: string, batch: PendingInputUpdateBatch): void => {
    const existing = pendingInputUpdatesByMatch.get(matchId);
    if (!existing) {
      pendingInputUpdatesByMatch.set(matchId, {
        maxSeqByUser: new Map(batch.maxSeqByUser),
        enqueuedCount: batch.enqueuedCount,
        firstEnqueuedAtMs: batch.firstEnqueuedAtMs,
      });
      return;
    }

    for (const [userId, seq] of batch.maxSeqByUser.entries()) {
      const previousSeq = existing.maxSeqByUser.get(userId);
      if (previousSeq == null || seq > previousSeq) {
        existing.maxSeqByUser.set(userId, seq);
      }
    }

    existing.enqueuedCount += batch.enqueuedCount;
    existing.firstEnqueuedAtMs = Math.min(existing.firstEnqueuedAtMs, batch.firstEnqueuedAtMs);
  };

  const persistInputUpdateBatch = async (matchId: string, batch: PendingInputUpdateBatch): Promise<void> => {
    const match = state.matches.get(matchId) as LocalMatch | undefined;
    if (!match) {
      return;
    }

    const persistAtRevision = async (revisionToUse: number): Promise<{ applied: boolean; nextRevision: number }> => {
      return matchRepository.withTransaction(async (tx) => {
        return matchRepository.updateWithRevision(tx, match.matchId, {
          expectedRevision: revisionToUse,
          nextState: match.state,
          liveState: buildLiveStateFromLocalMatch(match),
          instanceId: INSTANCE_ID,
          serverStartAt: new Date(match.serverStartAtMs),
          startedAt: match.state === "waiting_for_both" ? null : new Date(match.serverStartAtMs),
          endedAt: (match.state === "finished" || match.state === "aborted") ? new Date(match.stateChangedAt) : null,
        });
      });
    };

    const initialRevision = match.revision;
    let persistResult = await persistAtRevision(initialRevision);
    if (!persistResult.applied) {
      const latest = await matchRepository.load(match.matchId);
      if (!latest) {
        throw new Error("Match state sync failed while flushing pending INPUT_UPDATE batch");
      }

      let fullyCoveredByLatest = true;
      for (const [userId, pendingSeq] of batch.maxSeqByUser.entries()) {
        const latestSeq = latest.liveState?.participants?.[userId]?.seq ?? -1;
        if (latestSeq < pendingSeq) {
          fullyCoveredByLatest = false;
          break;
        }
      }

      if (fullyCoveredByLatest) {
        match.revision = latest.revision;
        return;
      }

      persistResult = await persistAtRevision(latest.revision);
      if (!persistResult.applied) {
        throw new Error("Match state changed while flushing pending INPUT_UPDATE batch");
      }
    }

    match.revision = persistResult.nextRevision;
  };

  // -------------------------------------------------------------------------
  // Input-update flush coordinator (P9 + P13)
  // Replaces the old dual-boolean mutex pattern.  See:
  //   src/infrastructure/input-flush-coordinator.ts
  // -------------------------------------------------------------------------
  const inputFlushCoordinator = new InputFlushCoordinator({
    pendingInputUpdatesByMatch,
    inputUpdateFlushRetriesByMatch,
    inputUpdateFlushMaxRetries: INPUT_UPDATE_FLUSH_MAX_RETRIES,
    persistBatch: persistInputUpdateBatch,
    mergeBatch: mergePendingInputBatch,
    onFlushStart: (reason) => incrementGatewayMetric("pvp_input_update_flush_total", { reason }),
    onFlushEnd: (reason, durationMs) =>
      observeGatewayHistogram(
        "pvp_input_update_flush_duration_ms",
        durationMs,
        [5, 10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000],
        { reason },
      ),
    onRequeue: (reason) => incrementGatewayMetric("pvp_input_update_requeue_total", { reason }),
  });

  /**
   * Schedule a flush of pending input-update batches to the database.
   * Returns immediately — the coordinator ensures serialized execution and
   * exactly one catch-up flush is buffered while a flush is running.
   *
   * For awaitable drain during shutdown use `inputFlushCoordinator.drain()`.
   */
  const flushPendingInputUpdates = (_reason: "timer" | "threshold" | "shutdown"): Promise<void> => {
    inputFlushCoordinator.schedule(_reason);
    return Promise.resolve();
  };

  const inputUpdateFlushInterval = setInterval(() => {
    void flushPendingInputUpdates("timer");
  }, INPUT_UPDATE_FLUSH_INTERVAL_MS);

  const clearDisconnectForfeitTimer = (matchId: string, userId: string): void => {
    const key = getDisconnectForfeitKey(matchId, userId);
    const existing = disconnectForfeitTimers.get(key);
    if (!existing) return;
    clearTimeout(existing);
    disconnectForfeitTimers.delete(key);
  };

  const clearNoShowTimer = (matchId: string): void => {
    const existing = noShowTimers.get(matchId);
    if (!existing) return;
    clearTimeout(existing);
    noShowTimers.delete(matchId);
  };

  const isParticipantReadyForMatchStart = (matchId: string, userId: string): boolean => {
    if (isAiUserId(userId)) return true;

    const session = activeMatchSessions.get(`${matchId}:${userId}`);
    if (!session) return false;
    if (session.readyState !== WebSocket.OPEN) return false;
    if (session.matchId !== matchId) return false;
    return true;
  };

  const getReadyParticipantCount = (matchId: string, match: LocalMatch): number => {
    let ready = 0;
    for (const userId of match.participants.keys()) {
      if (!isParticipantReadyForMatchStart(matchId, userId)) continue;
      ready += 1;
    }
    return ready;
  };

  const getMatchOpponentType = (match: LocalMatch): "bot" | "human" => {
    for (const userId of match.participants.keys()) {
      if (isAiUserId(userId)) return "bot";
    }
    return "human";
  };

  const maybeStartRankedCountdown = async (match: LocalMatch): Promise<boolean> => {
    if (match.roomCode !== null) return false;
    if (match.state !== "waiting_for_both") return false;

    const readyCount = getReadyParticipantCount(match.matchId, match);
    if (readyCount < match.participants.size) {
      incrementGatewayMetric("pvp_match_countdown_blocked_total", {
        reason: "participants_not_ready",
        opponent_type: getMatchOpponentType(match),
      });
      gatewayLogDebug("Ranked countdown waiting for participants", {
        matchId: match.matchId,
        readyParticipants: readyCount,
        totalParticipants: match.participants.size,
        state: match.state,
      });
      return false;
    }

    const lockResult = await matchRepository.withTransaction(async (tx) => {
      const locked = await matchRepository.loadForUpdate(tx, match.matchId);
      if (!locked) return { started: false as const };

      const lockedLiveState: MatchLiveState =
        locked.liveState ??
        createInitialLiveState({
          state: "waiting_for_both",
          participants: Array.from(match.participants.values()).map((participant) => ({
            userId: participant.userId,
            username: participant.username,
            avatar: participant.avatar,
            slot: participant.slot,
          })),
        });

      if (lockedLiveState.state !== "waiting_for_both") {
        return { started: false as const };
      }

      const serverStartAtMs = Date.now() + RANKED_MATCH_START_DELAY_MS;
      lockedLiveState.state = "countdown";
      lockedLiveState.stateChangedAtMs = Date.now();

      const updateResult = await matchRepository.updateWithRevision(tx, match.matchId, {
        expectedRevision: locked.revision,
        nextState: "countdown",
        liveState: lockedLiveState,
        instanceId: INSTANCE_ID,
        serverStartAt: new Date(serverStartAtMs),
        startedAt: locked.startedAt,
        endedAt: locked.endedAt,
      });

      if (!updateResult.applied) {
        return { started: false as const };
      }

      return {
        started: true as const,
        serverStartAtMs,
        nextRevision: updateResult.nextRevision,
      };
    });

    if (!lockResult.started) {
      incrementGatewayMetric("pvp_match_countdown_blocked_total", {
        reason: "db_lock_or_revision",
        opponent_type: getMatchOpponentType(match),
      });
      return false;
    }

    incrementGatewayMetric("pvp_match_waiting_ready_total", {
      opponent_type: getMatchOpponentType(match),
    });

    clearNoShowTimer(match.matchId);
    match.serverStartAtMs = lockResult.serverStartAtMs;
    const transitioned = applyMatchTransition({
      match,
      nextState: "countdown",
      eventBus,
      reason: "completed",
    });

    if (!transitioned) return false;

    match.revision = lockResult.nextRevision;

    for (const participant of match.participants.values()) {
      if (isAiUserId(participant.userId)) continue;
      sendToUser(wss, participant.userId, "MATCH_STATE", buildMatchStatePayload(match as unknown as Parameters<typeof buildMatchStatePayload>[0]));
    }

    gatewayLogInfo("Ranked countdown started", {
      matchId: match.matchId,
      serverStartAtMs: lockResult.serverStartAtMs,
      delayMs: Math.max(0, lockResult.serverStartAtMs - Date.now()),
      participants: match.participants.size,
      opponentType: getMatchOpponentType(match),
    });

    return true;
  };

  const scheduleNoShowTimeout = (matchId: string): void => {
    clearNoShowTimer(matchId);

    const initialMatch = state.matches.get(matchId) as LocalMatch | undefined;
    if (initialMatch && Array.from(initialMatch.participants.keys()).some((userId) => isAiUserId(userId))) {
      return;
    }

    const timer = setTimeout(() => {
      noShowTimers.delete(matchId);
      const match = state.matches.get(matchId) as LocalMatch | undefined;
      if (!match) return;
      if (match.roomCode !== null) return;
      if (match.state !== "waiting_for_both") return;

      const readyCount = getReadyParticipantCount(matchId, match);
      if (readyCount >= match.participants.size) {
        return;
      }

      const opponentType = getMatchOpponentType(match);
      incrementGatewayMetric("pvp_match_no_show_total", {
        opponent_type: opponentType,
      });
      gatewayLogWarn("Aborting ranked match due to no-show timeout", {
        matchId,
        opponentType,
        readyParticipants: readyCount,
        totalParticipants: match.participants.size,
        timeoutMs: MATCH_NO_SHOW_TIMEOUT_MS,
      });

      for (const userId of match.participants.keys()) {
        clearDisconnectForfeitTimer(matchId, userId);
      }

      void withMatchLock(toMatchId(matchId), () => abortMatchLifecycle({
        db,
        wss,
        state,
        eventBus,
        matchId,
        reasonCode: "no_show",
        reasonMessage: "The opponent did not connect in time, so the match was cancelled.",
      })).catch((err: unknown) => {
        gatewayLogError("No-show abort failed", err, { matchId });
      });
    }, MATCH_NO_SHOW_TIMEOUT_MS);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    noShowTimers.set(matchId, timer);
  };

  const persistReconnectGraceWindow = async (matchId: string, userId: string, reconnectUntilMs: number): Promise<void> => {
    await matchRepository.withTransaction(async (tx) => {
      const locked = await matchRepository.loadForUpdate(tx, matchId);
      if (!locked) return;
      if (locked.status === "FINISHED" || locked.status === "ABORTED") return;

      const liveState: MatchLiveState =
        locked.liveState ??
        createInitialLiveState({
          state: matchStateFromDbStatus(locked.status),
          participants: [],
        });

      const reconnectMap = liveState.reconnectUntilByUserId ?? {};
      reconnectMap[userId] = reconnectUntilMs;
      liveState.reconnectUntilByUserId = reconnectMap;

      await matchRepository.updateWithRevision(tx, matchId, {
        expectedRevision: locked.revision,
        nextState: liveState.state,
        liveState,
        instanceId: INSTANCE_ID,
        serverStartAt: locked.serverStartAt,
        startedAt: locked.startedAt,
        endedAt: locked.endedAt,
      });
    });
  };

  const scheduleDisconnectForfeit = (matchId: string, userId: string, delayMs = DISCONNECT_FORFEIT_GRACE_MS): void => {
    clearDisconnectForfeitTimer(matchId, userId);
    const timer = setTimeout(() => {
      disconnectForfeitTimers.delete(getDisconnectForfeitKey(matchId, userId));

      if (shouldDeferDisconnectForfeitForJoin({ joinInFlight: isMatchJoinInFlight(matchId, userId) })) {
        scheduleDisconnectForfeit(matchId, userId, DISCONNECT_FORFEIT_JOIN_DEFER_MS);
        return;
      }

      const activeMatch = state.matches.get(matchId) as LocalMatch | undefined;
      if (!activeMatch) return;
      if (
        !shouldScheduleDisconnectForfeit({
          policy: getDisconnectForfeitPolicy({
            roomCode: activeMatch.roomCode,
            participantCount: activeMatch.participants.size,
          }),
          participantCount: activeMatch.participants.size,
          otherActiveSocketsForUser: getAuthedSocketsForUser(wss, userId).length,
          matchState: activeMatch.state,
          matchStatus: activeMatch.status,
        })
      ) {
        return;
      }

      void withMatchLock(toMatchId(matchId), () => finalizeMatchByDisconnectForfeit({
        db,
        wss,
        state,
        eventBus,
        matchId,
        forfeitedUserId: userId,
      })).catch((err: unknown) => {
        gatewayLogError("Disconnect forfeit failed", err, { matchId, userId });
      });
    }, delayMs);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    disconnectForfeitTimers.set(getDisconnectForfeitKey(matchId, userId), timer);
  };

  const createLockedHumanRematch = async (params: {
    sourceMatchId: string;
    users: Array<ConnectionUser & { slot: number }>;
    persistUserIds: string[];
  }): Promise<boolean> => {
    if (rematchStartedByMatchId.has(params.sourceMatchId)) {
      return false;
    }

    rematchStartedByMatchId.add(params.sourceMatchId);
    const created = await createRanked1v1Match({
      users: params.users,
      persistUserIds: params.persistUserIds,
      startDelayMs: RANKED_MATCH_START_DELAY_MS,
    });

    const sourceMatch = state.matches.get(params.sourceMatchId) as LocalMatch | undefined;
    if (sourceMatch) {
      sourceMatch.rematchMatchId = toMatchId(created.matchId);
    }

    return true;
  };

  const releaseMatchSession = (ws: WsConn): void => {
    const key = ws.matchSessionKey;
    if (!key) return;
    const current = activeMatchSessions.get(key);
    if (current === ws) {
      activeMatchSessions.delete(key);
    }

    const keyMatchId = key.split(":")[0];
    if (keyMatchId) {
      matchCache?.removeSocket(keyMatchId, ws);
    }

    ws.matchSessionKey = undefined;
  };

  const updateSocketRoomSubscription = (ws: WsConn, nextRoomCode?: string): void => {
    const previousRoomCode = ws.roomCode;
    if (previousRoomCode && previousRoomCode !== nextRoomCode) {
      matchCache?.removeRoomSocket(previousRoomCode, ws);
    }

    ws.roomCode = nextRoomCode ? toRoomCode(nextRoomCode) : undefined;

    if (nextRoomCode) {
      matchCache?.addRoomSocket(nextRoomCode, ws);
    }
  };

  const claimMatchSession = (matchId: string, userId: string, ws: WsConn): void => {
    const key = `${matchId}:${userId}`;
    const existing = activeMatchSessions.get(key);
    const graceSeconds = Math.max(1, Math.round(MATCH_SESSION_SUPERSEDE_GRACE_MS / 1000));
    const hasOpenExistingSession = Boolean(existing && existing !== ws && existing.readyState === WebSocket.OPEN);

    if (existing && shouldRejectDuplicateMatchTab(hasOpenExistingSession ? 1 : 0)) {
      send(existing, "ERROR", {
        code: PVP_ERROR_CODES.MATCH_SESSION_SUPERSEDED,
        message: `This match was opened in another tab. This tab will close unless you switch back within ${graceSeconds} seconds.`,
        retryable: false,
        details: {
          phase: "match_session_claim",
          supersedeGraceMs: MATCH_SESSION_SUPERSEDE_GRACE_MS,
        },
      });

      const supersedeTimer = setTimeout(() => {
        try {
          const stillSupersededByNewSession = activeMatchSessions.get(key) === ws;
          if (stillSupersededByNewSession && existing.readyState === WebSocket.OPEN) {
            existing.close(4001, "Superseded by a newer match session");
          }
        } catch {
          // ignore
        }
      }, MATCH_SESSION_SUPERSEDE_GRACE_MS);

      if (typeof supersedeTimer.unref === "function") {
        supersedeTimer.unref();
      }
    }

    if (ws.matchSessionKey && ws.matchSessionKey !== key) {
      releaseMatchSession(ws);
    }

    activeMatchSessions.set(key, ws);
    ws.matchSessionKey = key;
    matchCache?.addSocket(matchId, ws);
  };

  const sweepStaleMatches = async (): Promise<void> => {
    const now = Date.now();

    const staleDbRows = await db
      .select({ id: pvpMatches.id })
      .from(pvpMatches)
      .where(
        or(
          and(eq(pvpMatches.status, "PENDING"), lte(pvpMatches.updatedAt, new Date(now - MATCH_NO_SHOW_TIMEOUT_MS))),
          and(eq(pvpMatches.status, "COUNTDOWN"), lte(pvpMatches.updatedAt, new Date(now - MATCH_MAX_COUNTDOWN_AGE_MS))),
          and(eq(pvpMatches.status, "RUNNING"), lte(pvpMatches.updatedAt, new Date(now - MATCH_MAX_LIVE_AGE_MS))),
        )
      )
      .orderBy(asc(pvpMatches.updatedAt))
      .limit(100);

    for (const row of staleDbRows) {
      const markedStale = await matchRepository.withTransaction(async (tx) => {
        const locked = await matchRepository.loadForUpdate(tx, row.id);
        if (!locked) return false;

        const updatedAtMs = toEpochMs(locked.updatedAt, now);
        const stateAgeMs = Math.max(0, now - updatedAtMs);
        const staleReason = getStaleMatchAbortReason({
          state: matchStateFromDbStatus(locked.status),
          stateAgeMs,
          maxCountdownAgeMs: MATCH_MAX_COUNTDOWN_AGE_MS,
          maxLiveAgeMs: MATCH_MAX_LIVE_AGE_MS,
        });

        const shouldAbortPendingNoShow =
          locked.status === "PENDING" &&
          stateAgeMs >= MATCH_NO_SHOW_TIMEOUT_MS;

        if (!staleReason && !shouldAbortPendingNoShow) return false;

        const liveState: MatchLiveState = locked.liveState ?? {
          state: matchStateFromDbStatus(locked.status),
          stateChangedAtMs: now,
          participants: {},
          forfeitedUserId: null,
          endedReason: null,
          rematchMatchId: null,
          finalizedAtMs: null,
          reconnectUntilByUserId: {},
          deltas: [],
        };

        liveState.state = "aborted";
        liveState.stateChangedAtMs = now;
        liveState.endedReason = "aborted";
        liveState.finalizedAtMs = now;

        const updateResult = await matchRepository.updateWithRevision(tx, row.id, {
          expectedRevision: locked.revision,
          nextState: "aborted",
          liveState,
          instanceId: INSTANCE_ID,
          serverStartAt: locked.serverStartAt,
          startedAt: locked.startedAt,
          endedAt: new Date(),
        });

        if (!updateResult.applied) return false;

        await matchRepository.clearLiveStateOnTerminal(tx, {
          matchId: row.id,
          expectedRevision: updateResult.nextRevision,
          status: "ABORTED",
          endedAt: new Date(),
        });

        return true;
      });

      if (!markedStale) continue;

      const local = state.matches.get(row.id) as LocalMatch | undefined;
      if (local) {
        for (const participant of local.participants.values()) {
          if (isAiUserId(participant.userId)) continue;
          sendToUser(wss, participant.userId, "MATCH_ENDED", {
            matchId: row.id,
            reason: "aborted",
            message: "This match was closed because the session became stale.",
            finalResultsPending: false,
          });
        }
      }

      // MatchCleanupService.dispose handles all timer cancellations, map
      // deletions, cache release, and state removal in one atomic call (P3).
      matchCleanupService?.dispose(toMatchId(row.id));
    }

    for (const [matchId, match] of state.matches.entries()) {
      const m = match as LocalMatch;
      if ((m.state === "finished" || m.state === "aborted") && m.finalizedAtMs && now - m.finalizedAtMs >= MATCH_RESULT_RETENTION_MS) {
        // P3: single dispose call replaces 5 manual resource-release lines.
        matchCleanupService?.dispose(toMatchId(matchId));
        continue;
      }

      const staleReason = getStaleMatchAbortReason({
        state: m.state,
        stateAgeMs: now - m.stateChangedAt,
        maxCountdownAgeMs: MATCH_MAX_COUNTDOWN_AGE_MS,
        maxLiveAgeMs: MATCH_MAX_LIVE_AGE_MS,
      });

      if (staleReason) {
        gatewayLogWarn("Sweeping stale active match", { matchId, staleReason, state: m.state });
        clearNoShowTimer(matchId);
        for (const userId of m.participants.keys()) {
          clearDisconnectForfeitTimer(matchId, userId);
        }
        await withMatchLock(toMatchId(matchId), () => abortMatchLifecycle({
          db,
          wss,
          state,
          eventBus,
          matchId,
          reasonMessage: staleReason === "stale_countdown" ? "This match expired before it could start." : "This match was closed because the session became stale.",
        }));
      }
    }

    for (const [key, socket] of activeMatchSessions.entries()) {
      if (socket.readyState !== WebSocket.OPEN || !socket.user) {
        activeMatchSessions.delete(key);
      }
    }

    for (const matchId of rematchAcceptedByMatchId.keys()) {
      if (!state.matches.has(matchId)) {
        clearRematchAccepted(matchId);
      }
    }

    for (const [matchId, touchedAtMs] of rematchAcceptedTouchedAtByMatchId.entries()) {
      if (now - touchedAtMs < REMATCH_ACCEPTED_TTL_MS) continue;
      clearRematchAccepted(matchId);
    }

    for (const [userId, refuseUntilMs] of aiRematchRefuseUntilByHumanId.entries()) {
      if (now < refuseUntilMs) continue;
      aiRematchRefuseUntilByHumanId.delete(userId);
    }
  };

  const staleMatchSweepInterval = setInterval(() => {
    void sweepStaleMatches().catch((error: unknown) => {
      gatewayLogError("Failed to sweep stale matches", error);
    });
  }, MATCH_SWEEP_INTERVAL_MS);
  if (typeof staleMatchSweepInterval.unref === "function") {
    staleMatchSweepInterval.unref();
  }

  let roomLifecycleSweepInterval: NodeJS.Timeout | null = null;
  if (isGatewayDbConfigured) {
    roomLifecycleSweepInterval = setInterval(() => {
      void sweepRoomLifecycle(db, wss, maybeAutoStartPublicRoom).catch((error: unknown) => {
        gatewayLogError("Failed to sweep room lifecycle", error);
      });
    }, ROOM_SWEEP_INTERVAL_MS);
    if (typeof roomLifecycleSweepInterval.unref === "function") {
      roomLifecycleSweepInterval.unref();
    }
  } else {
    gatewayLogWarn("Room lifecycle sweep disabled because DATABASE_URL is missing or malformed", {
      intervalMs: ROOM_SWEEP_INTERVAL_MS,
    });
  }

  const snapshotGatewayMetrics = (): void => {
    const pendingInputStats = getPendingInputQueueStats();

    setGatewayGauge("pvp_active_connections", wss.clients.size);
    setGatewayGauge("pvp_queue_depth", state.queue.length);
    setGatewayGauge("pvp_active_matches", getActiveMatchCount());
    setGatewayGauge("pvp_gateway_uptime_seconds", Number(process.uptime().toFixed(3)));
    setGatewayGauge("pvp_gateway_heap_used_bytes", process.memoryUsage().heapUsed);
    setGatewayGauge("pvp_input_update_pending_matches", pendingInputStats.pendingMatches);
    setGatewayGauge("pvp_input_update_pending_enqueued", pendingInputStats.totalEnqueued);
    setGatewayGauge("pvp_input_update_oldest_age_ms", pendingInputStats.oldestAgeMs);
    gatewayMetrics?.setConnectionsActive(wss.clients.size);
    gatewayMetrics?.setQueueLength("ranked", state.queue.length);
    gatewayMetrics?.setLifecycle({
      ready: gatewayHealthController?.isReady() ?? false,
      draining: gatewayHealthController?.isDraining() ?? false,
    });
  };

  snapshotGatewayMetrics();
  const metricSnapshotInterval = setInterval(snapshotGatewayMetrics, METRIC_SNAPSHOT_INTERVAL_MS);
  if (typeof metricSnapshotInterval.unref === "function") {
    metricSnapshotInterval.unref();
  }

  // =============================================================================
  // REDIS SETUP
  // =============================================================================

  if (USE_REDIS) {
    if (!REDIS_URL) throw new Error("PVP_USE_REDIS is enabled but PVP_REDIS_URL/REDIS_URL is missing");

    redisBus = await createRedisBus(REDIS_URL);
    gatewayLogInfo("Redis bus enabled for PvP gateway", {
      instanceId: INSTANCE_ID,
      hasRedisUrl: Boolean(REDIS_URL),
    });
    await redisBus.psubscribe("pvp:user:*");
    await redisBus.psubscribe("pvp:match:*");
    await redisBus.psubscribe("pvp:room:*");

    redisBus.onMessage((channel, msg) => {
      if (channel.startsWith("pvp:user:")) {
        const userId = channel.slice("pvp:user:".length);
        for (const c of getAuthedSocketsForUser(wss, userId)) send(c, msg.type as ServerMessage["type"], msg.payload);
        return;
      }
      if (channel.startsWith("pvp:match:")) {
        const matchId = channel.slice("pvp:match:".length);
        const cachedSockets = matchCache?.getMatchSockets(matchId);
        if (cachedSockets && cachedSockets.size > 0) {
          for (const socket of cachedSockets) {
            send(socket as WsConn, msg.type as ServerMessage["type"], msg.payload);
          }
        }
        return;
      }
      if (channel.startsWith("pvp:room:")) {
        const roomCode = channel.slice("pvp:room:".length);
        const roomSockets = matchCache?.getRoomSockets(roomCode);
        if (!roomSockets || roomSockets.size === 0) return;
        for (const socket of roomSockets) {
          const c = socket as WsConn;
          if (c.readyState !== WebSocket.OPEN) continue;
          send(c, msg.type as ServerMessage["type"], msg.payload);
        }
      }
    });
  }

  const redis = redisBus?.redis ?? null;
  const ONLINE_TTL_SEC = envInt("PVP_ONLINE_TTL_SEC", 90);
  const PRESENCE_REFRESH_MS = Math.max(5_000, Math.floor((ONLINE_TTL_SEC * 1000) / 3));

  const QUEUE_KEY_PREFIX = "pvp:queue:ranked";
  const QUEUE_META_KEY_PREFIX = "pvp:queue:user:";
  const QUEUE_RATING_RANGE = envInt("PVP_QUEUE_RATING_RANGE", 50);

  const QUEUE_MATCH_LUA = `
-- KEYS[1] = queue zset key
-- ARGV[1] = meId
-- ARGV[2] = minRating
-- ARGV[3] = maxRating
-- ARGV[4] = onlinePrefix
--
-- Returns: otherId (string) on successful mutual dequeue, nil otherwise.
--
-- Rollback contract:
--   r1=0, r2=0  neither removed (already dequeued by another node) → skip
--   r1=1, r2=0  "me" removed but opponent already gone → restore me
--   r1=0, r2=1  opponent removed but "me" already gone → restore opponent
--   r1=1, r2=1  both removed → return opponent
local me = ARGV[1]
local minR = tonumber(ARGV[2])
local maxR = tonumber(ARGV[3])
local onlinePrefix = ARGV[4]

local myScore = redis.call('ZSCORE', KEYS[1], me)
if not myScore then
  return nil
end

-- P14: Widened candidate window (was 20, now 50) to reduce miss rate under
-- moderate queue depths.
local candidates = redis.call('ZRANGEBYSCORE', KEYS[1], minR, maxR, 'LIMIT', 0, 50)
for i = 1, #candidates do
  local other = candidates[i]
  if other ~= me then
    local online = redis.call('EXISTS', onlinePrefix .. other)
    if online == 1 then
      -- Save opponent's score BEFORE attempting removal so we can restore on
      -- partial failure (P14 rollback fix: r1=0, r2=1 case).
      local otherScore = redis.call('ZSCORE', KEYS[1], other)
      local r1 = redis.call('ZREM', KEYS[1], me)
      local r2 = redis.call('ZREM', KEYS[1], other)
      if r1 == 1 and r2 == 1 then
        return other
      else
        if r1 == 1 then
          -- We dequeued ourselves but opponent was concurrently removed.
          -- Restore our own entry.
          redis.call('ZADD', KEYS[1], myScore, me)
        end
        if r2 == 1 then
          -- Opponent was dequeued but we were already gone (concurrent dequeue
          -- by another gateway instance). Restore opponent's entry.
          if otherScore then
            redis.call('ZADD', KEYS[1], otherScore, other)
          end
        end
      end
    end
  end
end

return nil
`;

  /**
   * Lazily loaded SHA-1 of `QUEUE_MATCH_LUA` for EVALSHA caching (P14).
   * `null` means the script has not been loaded into this Redis instance yet.
   */
  let queueMatchLuaSha: string | null = null;

  async function markOnline(userId: string): Promise<void> {
    if (!redis) return;
    await redis.set(`${ONLINE_KEY_PREFIX}${userId}`, INSTANCE_ID, "EX", ONLINE_TTL_SEC);
  }

  async function readQueueMeta(userId: string): Promise<QueuedUserMeta | null> {
    if (!redis) return null;
    const raw = await redis.get(`${QUEUE_META_KEY_PREFIX}${userId}`);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as QueuedUserMeta;
    } catch {
      return null;
    }
  }

  async function queueLeave(userId: string): Promise<number> {
    if (!redis) return 0;
    const meta = await readQueueMeta(userId);
    if (!meta) return 0;

    const removed = await redis.zrem(meta.bucketKey, userId);
    await redis.del(`${QUEUE_META_KEY_PREFIX}${userId}`);
    return removed;
  }

  async function queueJoin(user: ConnectionUser): Promise<QueuedUserMeta | null> {
    if (!redis) return null;

    const preference = normalizeMatchmakingPreference(user.matchmakingPreference);
    const bucketKey = buildQueueBucketKey(QUEUE_KEY_PREFIX, preference);
    const joinedAtMs = Date.now();
    const meta: QueuedUserMeta = {
      bucketKey,
      joinedAtMs,
      preference,
      rating: user.pvpRating,
    };

    await redis.zadd(bucketKey, String(user.pvpRating), user.userId);
    await redis.set(`${QUEUE_META_KEY_PREFIX}${user.userId}`, JSON.stringify(meta), "EX", Math.ceil(AI_QUEUE_TIMEOUT_MS / 1000) + 120);
    return meta;
  }

  async function tryMatchQueuedUser(user: ConnectionUser): Promise<{ otherId: string; me: QueuedUserMeta; other: QueuedUserMeta | null } | null> {
    if (!redis) return null;
    const me = await readQueueMeta(user.userId);
    if (!me) return null;

    const currentRange = getExpandedQueueRatingRange(Date.now() - me.joinedAtMs, {
      ...DEFAULT_QUEUE_BAND_CONFIG,
      initialRange: QUEUE_RATING_RANGE,
    });
    const minR = user.pvpRating - currentRange;
    const maxR = user.pvpRating + currentRange;
    const evalArgs = [1, me.bucketKey, user.userId, String(minR), String(maxR), ONLINE_KEY_PREFIX] as const;

    let otherId: string | null = null;

    // P14: Use EVALSHA to avoid re-transmitting the script on every call.
    // Falls back to EVAL with a fresh SCRIPT LOAD on NOSCRIPT errors (e.g.
    // Redis restart, Redis Cluster migration).
    if (queueMatchLuaSha) {
      try {
        otherId = await redis.evalsha(queueMatchLuaSha, ...evalArgs) as string | null;
      } catch (evalShaErr: unknown) {
        const isNoscript =
          evalShaErr instanceof Error && evalShaErr.message.includes("NOSCRIPT");
        if (!isNoscript) throw evalShaErr;
        // Script evicted from server cache — reload and fall through to EVAL.
        queueMatchLuaSha = null;
        otherId = await redis.eval(QUEUE_MATCH_LUA, ...evalArgs) as string | null;
      }
    } else {
      otherId = await redis.eval(QUEUE_MATCH_LUA, ...evalArgs) as string | null;
      // Eagerly cache the SHA so subsequent calls use EVALSHA.
      try {
        queueMatchLuaSha = await redis.script("LOAD", QUEUE_MATCH_LUA) as string;
      } catch {
        // Non-fatal — next call will EVAL again and retry the load.
      }
    }

    if (!otherId || typeof otherId !== "string") return null;

    const other = await readQueueMeta(otherId);
    await redis.del(`${QUEUE_META_KEY_PREFIX}${user.userId}`, `${QUEUE_META_KEY_PREFIX}${otherId}`);
    return { otherId, me, other };
  }

  // ---------------------------------------------------------------------------
  // Unified queue adapter (P10)
  // ---------------------------------------------------------------------------
  const queueAdapter = redis
    ? new RedisQueueAdapter({ queueJoin, queueLeave, readQueueMeta, tryMatchQueuedUser })
    : new LocalMemoryQueueAdapter();

  // =============================================================================
  // REMATCH STATE
  // =============================================================================

  const AI_REMATCH_COOLDOWN_MS = envMs("PVP_AI_REMATCH_COOLDOWN_MS", 20 * 60 * 1000);
  const aiRematchRefuseUntilByHumanId = new Map<string, number>();
  const rematchAcceptedByMatchId = new Map<string, Set<string>>();
  const rematchAcceptedTouchedAtByMatchId = new Map<string, number>();
  const REMATCH_ACCEPTED_TTL_MS = envMs("PVP_REMATCH_ACCEPTED_TTL_MS", 10 * 60 * 1000);

  const clearRematchAccepted = (matchId: string): void => {
    rematchAcceptedByMatchId.delete(matchId);
    rematchAcceptedTouchedAtByMatchId.delete(matchId);
  };

  // =============================================================================
  // ROOM MATCH START
  // =============================================================================

  const startRoomMatch = async (params: {
    roomId: string;
    roomCode: string;
    members: Array<{
      userId: string;
      colorSlot: number;
      readyAt: Date | null;
      leftAt: Date | null;
      user: { username: string | null; profile: { avatar: string | null } | null };
    }>;
    startDelayMs?: number;
  }): Promise<{ matchId: string; local: LocalMatch; serverStartAtMs: number } | null> => {
    const activeMembers = params.members.filter((member) => member.leftAt === null);
    if (activeMembers.length < 2) {
      return null;
    }

    const serverStartAtMs = Date.now() + (params.startDelayMs ?? ROOM_MATCH_START_DELAY_MS);
    const createdMatchRows = await db
      .insert(pvpMatches)
      .values({
        status: "COUNTDOWN",
        roomId: params.roomId,
        textSnapshot: "placeholder",
        serverStartAt: new Date(serverStartAtMs),
      })
      .returning({ id: pvpMatches.id });

    const match = createdMatchRows[0];
    if (!match) {
      throw new Error("Failed to create room match");
    }

    const local = state.createLocalMatch({
      matchId: match.id,
      roomCode: params.roomCode,
      users: activeMembers.map((member) => ({
        userId: member.userId,
        username: sanitizeDisplayName(member.user.username ?? "user", 32) || "user",
        avatar: member.user.profile?.avatar ?? null,
        pvpRating: 1500,
        pvpDeviation: 350,
        slot: member.colorSlot,
      })),
      serverStartAtMs,
    }) as LocalMatch;
    eventBus.emit("match:countdown", {
      matchId: match.id,
      from: "lobby",
      to: "countdown",
      roomCode: params.roomCode,
      atMs: local.stateChangedAt,
    });

    await db
      .update(pvpMatches)
      .set({ textSnapshot: local.textSnapshot, updatedAt: new Date() })
      .where(eq(pvpMatches.id, match.id));

    if (activeMembers.length > 0) {
      await db
        .insert(pvpParticipants)
        .values(
          activeMembers.map((member) => ({
            matchId: match.id,
            userId: member.userId,
            slot: member.colorSlot,
          }))
        )
        .onConflictDoNothing({ target: [pvpParticipants.matchId, pvpParticipants.userId] });
    }

    await db
      .update(pvpRooms)
      .set({ status: "IN_MATCH", autoStartAt: null, updatedAt: new Date() })
      .where(eq(pvpRooms.id, params.roomId));

    broadcastRoom(wss, params.roomCode, "MATCH_FOUND", {
      matchId: match.id,
      textSnapshot: local.textSnapshot,
      serverStartAt: new Date(serverStartAtMs).toISOString(),
      inputNonce: local.inputNonce,
      players: Array.from(local.participants.values()).map((participant) => ({
        userId: participant.userId,
        username: participant.username,
        avatar: participant.avatar,
        slot: participant.slot,
      })),
    });

    return { matchId: match.id, local, serverStartAtMs };
  };

  const maybeAutoStartPublicRoom = async (roomCode: string): Promise<boolean> => {
    const roomRows = await db
      .select({
        id: pvpRooms.id,
        code: pvpRooms.code,
        status: pvpRooms.status,
        visibility: pvpRooms.visibility,
        minPlayers: pvpRooms.minPlayers,
        maxPlayers: pvpRooms.maxPlayers,
        autoStartAt: pvpRooms.autoStartAt,
      })
      .from(pvpRooms)
      .where(eq(pvpRooms.code, roomCode))
      .limit(1);

    const roomBase = roomRows[0] ?? null;
    if (!roomBase || roomBase.status !== "OPEN" || roomBase.visibility !== "PUBLIC") {
      return false;
    }

    const memberRows = await db
      .select({
        userId: pvpRoomMembers.userId,
        colorSlot: pvpRoomMembers.colorSlot,
        readyAt: pvpRoomMembers.readyAt,
        leftAt: pvpRoomMembers.leftAt,
        username: users.username,
        avatar: playerProfiles.avatar,
      })
      .from(pvpRoomMembers)
      .innerJoin(users, eq(pvpRoomMembers.userId, users.id))
      .leftJoin(playerProfiles, eq(pvpRoomMembers.userId, playerProfiles.userId))
      .where(and(eq(pvpRoomMembers.roomId, roomBase.id), isNull(pvpRoomMembers.leftAt)))
      .orderBy(asc(pvpRoomMembers.joinedAt));

    const room = {
      ...roomBase,
      members: memberRows.map((member) => ({
        userId: member.userId,
        colorSlot: member.colorSlot,
        readyAt: member.readyAt,
        leftAt: member.leftAt,
        user: {
          username: member.username,
          profile: { avatar: member.avatar },
        },
      })),
    };

    const startCondition = getPublicRoomStartCondition({
      members: room.members,
      minimumPlayers: room.minPlayers,
      maxPlayers: room.maxPlayers,
      autoStartAt: room.autoStartAt,
    });
    if (!startCondition) {
      return false;
    }

    await startRoomMatch({
      roomId: room.id,
      roomCode: room.code,
      members: room.members,
    });
    return true;
  };

  // =============================================================================
  // DATABASE PREPARED STATEMENTS
  // =============================================================================

  const loadConnectionUserWithPreferencePrepared = db.query.users
    .findFirst({
      columns: {
        username: true,
        banned: true,
      },
      where: eq(users.id, sql.placeholder("userId")),
      with: {
        profile: {
          columns: {
            avatar: true,
            longTermStats: true,
          },
        },
        pvpRating: {
          columns: {
            rating: true,
            deviation: true,
          },
        },
        pvpMatchmakingPreference: {
          columns: {
            preferredMode: true,
          },
        },
      },
    })
    .prepare("pvp_gateway_load_connection_user_with_preference");

  const loadConnectionUserWithoutPreferencePrepared = db.query.users
    .findFirst({
      columns: {
        username: true,
        banned: true,
      },
      where: eq(users.id, sql.placeholder("userId")),
      with: {
        profile: {
          columns: {
            avatar: true,
            longTermStats: true,
          },
        },
        pvpRating: {
          columns: {
            rating: true,
            deviation: true,
          },
        },
      },
    })
    .prepare("pvp_gateway_load_connection_user_without_preference");

  async function loadConnectionUser(userId: string): Promise<ConnectionUser> {
    const cache = connectionUserCache;
    if (!cache) {
      throw new Error("User cache not initialized");
    }

    return cache.getOrLoad(userId, async () => {
      const shouldSkipPreferenceLookup =
        hasPvpMatchmakingPreferenceTable.value === false &&
        Date.now() - pvpMatchmakingPreferenceTableLastCheckedAt.value < PVP_PREFERENCE_TABLE_RETRY_MS;

      let user:
        | {
            username: string;
            banned: boolean;
            profile: { avatar: string | null; longTermStats: unknown };
            pvpRating: { rating: number; deviation: number };
            pvpMatchmakingPreference?: { preferredMode: string };
          }
        | null
        | undefined;

      const loadUserWithoutPreference = async (): Promise<{
        username: string;
        banned: boolean;
        profile: { avatar: string | null; longTermStats: unknown };
        pvpRating: { rating: number; deviation: number };
        pvpMatchmakingPreference?: { preferredMode: string };
      } | null> => {
        const result = await loadConnectionUserWithoutPreferencePrepared.execute({ userId });
        if (!result) {
          return null;
        }
        return {
          ...result,
          pvpMatchmakingPreference: undefined,
        };
      };

      const loadUserWithPreference = async (): Promise<{
        username: string;
        banned: boolean;
        profile: { avatar: string | null; longTermStats: unknown };
        pvpRating: { rating: number; deviation: number };
        pvpMatchmakingPreference: { preferredMode: string };
      } | null> => {
        const result = await loadConnectionUserWithPreferencePrepared.execute({ userId });
        if (!result) {
          return null;
        }
        return result;
      };

      if (shouldSkipPreferenceLookup) {
        user = await loadUserWithoutPreference();
      } else {
        try {
          user = await loadUserWithPreference();
          hasPvpMatchmakingPreferenceTable.value = true;
          pvpMatchmakingPreferenceTableLastCheckedAt.value = Date.now();
        } catch (error) {
          if (!isMissingPvpMatchmakingPreferenceTable(error)) {
            throw error;
          }

          hasPvpMatchmakingPreferenceTable.value = false;
          pvpMatchmakingPreferenceTableLastCheckedAt.value = Date.now();
          logMissingGatewayPreferenceTableOnce();
          user = await loadUserWithoutPreference();
        }
      }

      if (!user || user.banned) {
        gatewayLogWarn("Rejected PvP user load because the user is unavailable", {
          userId,
          reason: !user ? "missing_user" : "banned_user",
        });
        throw buildQueueError({
          code: PVP_ERROR_CODES.QUEUE_USER_UNAVAILABLE,
          message: "Your PvP session is no longer available. Refresh and rejoin the queue.",
          retryable: true,
          details: { phase: "load_connection_user" },
        });
      }

      const rating = user.pvpRating ?? { rating: 1500, deviation: 350 };
      const rankInfo = getPvpRankInfo(rating.rating);

      return {
        userId,
        username: sanitizeDisplayName(user.username ?? "user", 32) || "user",
        avatar: sanitizeAvatarUrl(user.profile?.avatar ?? null),
        pvpRating: rating.rating,
        pvpDeviation: rating.deviation,
        rankTier: rankInfo.tier,
        averageWpm: extractAverageWpm(user.profile?.longTermStats),
        matchmakingPreference: normalizeMatchmakingPreference({
          mode: user.pvpMatchmakingPreference?.preferredMode ?? undefined,
        }),
      };
    });
  }

  // =============================================================================
  // CREATE RANKED MATCH
  // =============================================================================

  async function createRanked1v1Match(params: {
    users: Array<(ConnectionUser & { slot: number })>;
    persistUserIds: string[];
    startDelayMs?: number;
  }): Promise<{ matchId: string; local: LocalMatch; serverStartAtMs: number; payload: unknown }> {
    const matchId = crypto.randomUUID();
    const hasAiParticipant = params.users.some((user) => isAiUserId(user.userId));
    const initialState: MatchLifecycleState = hasAiParticipant ? "countdown" : "waiting_for_both";
    const initialDbStatus = hasAiParticipant ? "COUNTDOWN" : "PENDING";
    const requestedPersistUserIds = Array.from(new Set(params.persistUserIds.filter((userId) => !isAiUserId(userId))));
    let persistUserIds = requestedPersistUserIds;

    if (requestedPersistUserIds.length > 0) {
      const existingUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, requestedPersistUserIds));

      const existingUserIds = new Set(existingUsers.map((row) => row.id));
      persistUserIds = requestedPersistUserIds.filter((userId) => existingUserIds.has(userId));

      if (persistUserIds.length !== requestedPersistUserIds.length) {
        incrementGatewayMetric("pvp_match_participant_persist_skipped_total", {
          reason: "user_not_found",
        });
        gatewayLogWarn("Skipping non-persistable ranked participants", {
          matchId,
          requestedPersistUserIds,
          persistedUserIds: persistUserIds,
        });
      }
    }

    const rankedText = await selectRankedText({
      matchId,
      userIds: persistUserIds,
      redis,
    });
    const inputNonce = createInputNonce();
    const liveState = createInitialLiveState({
      state: initialState,
      participants: params.users,
    });

    const serverStartAtMs = Date.now() + (params.startDelayMs ?? RANKED_MATCH_START_DELAY_MS);

    await runGatewayTransaction(db, async (tx) => {
      await tx.insert(pvpMatches).values({
        id: matchId,
        status: initialDbStatus,
        textSnapshot: rankedText.textSnapshot,
        textId: rankedText.textId,
        inputNonce,
        serverStartAt: hasAiParticipant ? new Date(serverStartAtMs) : null,
        revision: 1,
        instanceId: INSTANCE_ID,
        liveState: liveState as unknown,
      }).onConflictDoNothing({ target: [pvpMatches.id] });

      if (persistUserIds.length) {
        try {
          await tx
            .insert(pvpParticipants)
            .values(
              persistUserIds.map((userId) => ({
                matchId,
                userId,
                slot: params.users.find((u) => u.userId === userId)?.slot ?? 0,
              }))
            )
            .onConflictDoNothing({ target: [pvpParticipants.matchId, pvpParticipants.userId] });
        } catch (error) {
          if (!ALLOW_PARTICIPANT_PERSIST_FALLBACK) {
            throw error;
          }

          incrementGatewayMetric("pvp_match_participant_persist_skipped_total", {
            reason: "insert_failure",
          });

          gatewayLogWarn("Skipping participant persistence for ranked match after insert failure", {
            matchId,
            persistUserIds,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    const local = state.createLocalMatch({
      matchId,
      roomCode: null,
      users: params.users,
      serverStartAtMs,
      initialState,
      textSnapshot: rankedText.textSnapshot,
      textId: rankedText.textId,
      inputNonce,
    }) as LocalMatch;

    if (hasAiParticipant) {
      eventBus.emit("match:countdown", {
        matchId,
        from: "lobby",
        to: "countdown",
        roomCode: null,
        atMs: local.stateChangedAt,
      });
    }

    await registerReplayNonce(redis, matchId, local.inputNonce);

    const payload = {
      matchId,
      textSnapshot: local.textSnapshot,
      textId: local.textId,
      inputNonce: local.inputNonce,
      serverStartAt: new Date(serverStartAtMs).toISOString(),
      players: params.users.map((user) => buildMatchFoundPlayerPayload(user)),
    };

    for (const u of params.users) {
      if (isAiUserId(u.userId)) continue;
      sendToUser(wss, u.userId, "MATCH_FOUND", payload);
    }

    if (!hasAiParticipant) {
      scheduleNoShowTimeout(matchId);
    }

    gatewayLogInfo("Created ranked 1v1 match", {
      matchId,
      hasAiParticipant,
      initialState,
      initialDbStatus,
      userIds: params.users.map((user) => user.userId),
      requestedPersistUserIds,
      persistedUserIds: persistUserIds,
      serverStartDelayMs: Math.max(0, serverStartAtMs - Date.now()),
    });

    return { matchId, local, serverStartAtMs, payload };
  }

  // =============================================================================
  // WEBSOCKET CONNECTION HANDLER
  // =============================================================================

  // ---------------------------------------------------------------------------
  // Wire up the GatewayDeps container — one snapshot of all runtime services,
  // mutable-state maps, constants, and callback closures extracted from main().
  // ---------------------------------------------------------------------------
  const deps: GatewayDeps = {
    // Core services
    db,
    redisBus,
    state,
    matchCache,
    connectionUserCache,
    wss,
    messageBatcher,
    matchRepository,
    matchLockRegistry,
    matchCleanupService,
    eventBus,
    gatewayMetrics,
    gatewayHealthController,
    idempotencyStore,
    // Mutable state collections
    disconnectForfeitTimers,
    noShowTimers,
    activeMatchSessions,
    rematchStartedByMatchId,
    pendingInputUpdatesByMatch,
    inputUpdateFlushRetriesByMatch,
    roomActionLastSeen,
    inFlightMatchJoins,
    matchFinalizationLocks,
    matchCleanupTimers,
    firstPlaceFinalizationTimers,
    rematchAcceptedByMatchId,
    rematchAcceptedTouchedAtByMatchId,
    aiRematchRefuseUntilByHumanId,
    // Mutable primitive flags (passed as { value } refs so mutations are visible)
    hasPvpMatchmakingPreferenceTable,
    pvpMatchmakingPreferenceTableLastCheckedAt,
    // Runtime constants
    instanceId: INSTANCE_ID,
    allowParticipantPersistFallback: ALLOW_PARTICIPANT_PERSIST_FALLBACK,
    testForceBotMatch: TEST_FORCE_BOT_MATCH,
    testBypass: TEST_BYPASS,
    aiQueueTimeoutMs: AI_QUEUE_TIMEOUT_MS,
    inputUpdateFlushMaxRetries: INPUT_UPDATE_FLUSH_MAX_RETRIES,
    inputUpdateFlushMaxEnqueued: INPUT_UPDATE_FLUSH_MAX_ENQUEUED,
    matchResumeDeltaLimit: MATCH_RESUME_DELTA_LIMIT,
    disconnectForfeitJoinDeferMs: DISCONNECT_FORFEIT_JOIN_DEFER_MS,
    matchSnapshotIntervalMs: MATCH_SNAPSHOT_INTERVAL_MS,
    roomActionCooldownMs: ROOM_ACTION_COOLDOWN_MS,
    onlineKeyPrefix: ONLINE_KEY_PREFIX,
    onlineTtlSec: ONLINE_TTL_SEC,
    presenceRefreshMs: PRESENCE_REFRESH_MS,
    queueKeyPrefix: QUEUE_KEY_PREFIX,
    queueMetaKeyPrefix: QUEUE_META_KEY_PREFIX,
    queueRatingRange: QUEUE_RATING_RANGE,
    rematchAcceptedTtlMs: REMATCH_ACCEPTED_TTL_MS,
    aiRematchCooldownMs: AI_REMATCH_COOLDOWN_MS,
    wsPingIntervalMs: WS_PING_INTERVAL_MS,
    // Locks
    localQueueLock,
    matchJoinLock,
    // Callbacks
    flushPendingInputUpdates,
    scheduleNoShowTimeout,
    clearNoShowTimer,
    clearDisconnectForfeitTimer,
    scheduleDisconnectForfeit,
    maybeStartRankedCountdown,
    loadConnectionUser,
    createRanked1v1Match,
    startRoomMatch,
    maybeAutoStartPublicRoom,
    beginMatchJoinInFlight,
    endMatchJoinInFlight,
    isMatchJoinInFlight,
    claimMatchSession,
    releaseMatchSession,
    updateSocketRoomSubscription,
    markOnline,
    createLockedHumanRematch,
    enqueueInputUpdateBatch,
    queueAdapter,
    persistReconnectGraceWindow,
  };

  const wsOpts: WsServerOpts = {
    maxPayloadBytes: WS_MAX_PAYLOAD_BYTES,
    maxMsgBurst: WS_MAX_MSG_BURST,
    maxMsgPerSec: WS_MAX_MSG_PER_SEC,
    maxInputMsgBurst: WS_MAX_INPUT_MSG_BURST,
    maxInputMsgPerSec: WS_MAX_INPUT_MSG_PER_SEC,
    maxConnectionsPerIp: WS_MAX_CONNECTIONS_PER_IP,
    connectionAttemptsBurst: WS_CONNECTION_ATTEMPTS_BURST,
    connectionAttemptsPerMin: WS_CONNECTION_ATTEMPTS_PER_MIN,
    pingIntervalMs: WS_PING_INTERVAL_MS,
    roomActionCooldownMs: ROOM_ACTION_COOLDOWN_MS,
    connectionSpikeAlertThreshold: CONNECTION_SPIKE_ALERT_THRESHOLD,
    globalConnPerSec: WS_GLOBAL_CONNECTIONS_PER_SEC,
    globalConnBurst: WS_GLOBAL_CONNECTIONS_BURST,
    disconnectForfeitGraceMs: DISCONNECT_FORFEIT_GRACE_MS,
    roomReconnectGraceMs: ROOM_RECONNECT_GRACE_MS,
  };

  const connWsState: WsServerState = {
    activeConnectionsByIp,
    connectionAttemptBuckets,
    globalConnectionBucket,
  };

  setupWssConnectionHandler(wss, deps, wsOpts, connWsState);

  // =============================================================================
  // SHUTDOWN HANDLING
  // =============================================================================

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  let shutdownPromise: Promise<void> | null = null;
  const beginGracefulShutdown = (signal: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      gatewayLogWarn("Starting graceful shutdown", {
        signal,
        instanceId: INSTANCE_ID,
        activeConnections: wss.clients.size,
        activeMatches: getActiveMatchCount(),
      });

      gatewayHealthController?.beginDraining();
      gatewayMetrics?.setLifecycle({
        ready: gatewayHealthController?.isReady() ?? false,
        draining: gatewayHealthController?.isDraining() ?? true,
      });

      const serverClosed = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      const websocketClosed = new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });

      for (const client of Array.from(wss.clients)) {
        const socket = client as WsConn;
        if (socket.user) {
          state.removeFromQueue(socket.user.userId);
          state.clearQueueTimeout(socket.user.userId);
          void queueLeave(socket.user.userId);
        }

        if (!socket.matchId) {
          try {
            socket.close(1001, "Gateway draining");
          } catch {
            // ignore
          }
        }
      }

      const deadlineAt = Date.now() + SHUTDOWN_GRACE_MS;
      while (Date.now() < deadlineAt && getActiveMatchCount() > 0) {
        await sleep(250);
      }

      messageBatcher?.flushAll();
      messageBatcher?.stop();
      clearInterval(inputUpdateFlushInterval);
      inputFlushCoordinator.stop();
      await inputFlushCoordinator.drain();

      for (const client of Array.from(wss.clients)) {
        try {
          (client as WsConn).close(1001, "Gateway shutting down");
        } catch {
          // ignore
        }
      }

      await sleep(250);

      for (const client of Array.from(wss.clients)) {
        try {
          (client as WsConn).terminate();
        } catch {
          // ignore
        }
      }

      clearInterval(metricSnapshotInterval);
      if (roomLifecycleSweepInterval) {
        clearInterval(roomLifecycleSweepInterval);
      }
      rematchAcceptedByMatchId.clear();
      rematchAcceptedTouchedAtByMatchId.clear();
      aiRematchRefuseUntilByHumanId.clear();
      inFlightMatchJoins.clear();
      inputUpdateFlushRetriesByMatch.clear();
      for (const timeout of disconnectForfeitTimers.values()) {
        clearTimeout(timeout);
      }
      disconnectForfeitTimers.clear();
      for (const timeout of state.queueTimeouts.values()) {
        clearTimeout(timeout);
      }
      state.queueTimeouts.clear();
      for (const timer of matchCleanupTimers.values()) {
        clearTimeout(timer);
      }
      matchCleanupTimers.clear();
      for (const timer of firstPlaceFinalizationTimers.values()) {
        clearTimeout(timer);
      }
      firstPlaceFinalizationTimers.clear();
      for (const interval of state.aiIntervals.values()) {
        clearInterval(interval);
      }
      state.aiIntervals.clear();

      await Promise.allSettled([serverClosed, websocketClosed]);
      await Promise.allSettled([redisBus?.close()]);

      gatewayLogInfo("Graceful shutdown complete", {
        signal,
        instanceId: INSTANCE_ID,
      });
    })().catch((error: unknown) => {
      gatewayLogError("Graceful shutdown failed", error, {
        signal,
        instanceId: INSTANCE_ID,
      });
      throw error;
    });

    return shutdownPromise;
  };

  process.once("SIGINT", () => {
    void beginGracefulShutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void beginGracefulShutdown("SIGTERM");
  });

  let startupErrorHandled = false;
  const handleStartupServerError = (error: unknown): void => {
    if (startupErrorHandled) return;
    startupErrorHandled = true;

    const candidate = error as { code?: unknown; errno?: unknown; syscall?: unknown; address?: unknown; port?: unknown } | null;
    const code = String(candidate?.code ?? "");
    if (code === "EADDRINUSE") {
      gatewayLogError("PvP gateway failed to bind listen port", error, {
        port: PORT,
      });
      gatewayLogWarn("Port is already in use. Stop the other gateway process or set a different PORT.", {
        port: PORT,
        hint: "Example: set PORT=8788 before starting the gateway",
      });
      process.exitCode = 1;
      process.nextTick(() => process.exit(1));
      return;
    }

    gatewayLogError("PvP gateway server error", error, {
      port: PORT,
    });
    process.exitCode = 1;
    process.nextTick(() => process.exit(1));
  };

  server.once("error", handleStartupServerError);
  wss.on("error", handleStartupServerError);

  server.listen(PORT, () => {
    gatewayLogInfo("PvP gateway listening", { port: PORT, instanceId: INSTANCE_ID });
  });
}

void main().catch((error: unknown) => {
  gatewayLogError("PvP gateway failed to start", error, {
    instanceId: INSTANCE_ID,
  });
  throw error;
});