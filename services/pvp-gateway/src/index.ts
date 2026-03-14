import "./load-env";

import crypto from "crypto";
import fs from "fs";
import http from "http";
import https from "https";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { Prisma, PrismaClient } from "@prisma/client";

import { safeParseClientMessage, toJson, type ServerMessage } from "./protocol";
import { assertWsTokenState, verifyWsTokenFast, verifyWsTokenStrict, type WsAuthContext } from "./auth";
import { InMemoryState, type ConnectionUser } from "./state";
import { updateElo1v1 } from "./mmr";
import { ratingFromWpm } from "./ai";
import { createTokenBucket, tryConsume, type TokenBucket } from "./rate-limit";
import { createRedisBus, matchChannel, roomChannel, userChannel, type RedisBus } from "./redis-bus";
import { incrementGatewayMetric, observeGatewayHistogram, renderGatewayMetrics, setGatewayGauge } from "./metrics";
import { createGatewayEventBus } from "./events";
import { createGatewayHealthController, type GatewayHealthController } from "./health";
import { buildIdempotencyKey, getIdempotencyRecord, getIdempotencyTtlSeconds, InMemoryIdempotencyStore, setIdempotencyRecord, type IdempotencyRecord } from "./idempotency";
import { buildDisconnectForfeitOutcome, runDisconnectForfeitSequence } from "./disconnect-forfeit";
import { enqueueOrMatchInMemory } from "./in-memory-queue";
import {
  buildQueueBucketKey,
  DEFAULT_QUEUE_BAND_CONFIG,
  getExpandedQueueRatingRange,
  normalizeMatchmakingPreference,
  type MatchmakingPreference,
} from "./matchmaking/bands";
import { recordQueueMatchMetrics } from "./matchmaking/metrics";
import { shouldAcceptInputUpdate } from "./input-update";
import { createLocalLock } from "./local-lock";
import { matchStateFromDbStatus, matchStateToDbStatus, matchStateToLegacyStatus, transitionMatchState, type MatchLifecycleState } from "./match-fsm";
import { buildMatchStatePayload, buildProgressPayload, markMatchSnapshotBroadcast, shouldBroadcastPeriodicMatchSnapshot } from "./match-sync";
import { createMessageBatcher, isBatchableServerMessage } from "./message-batcher";
import { invalidatePvpSelfCaches } from "./pvp-rating-cache";
import { assessMatch } from "./anti-cheat/anomaly";
import { recordCheatAssessment } from "./anti-cheat/flagging";
import { clearReplayProtection, registerAcceptedReplaySeq, registerReplayNonce, validateReplayProtectedInput } from "./anti-cheat/replay";
import { getDisconnectForfeitPolicy, getStaleMatchAbortReason, shouldRejectDuplicateMatchTab, shouldScheduleDisconnectForfeit } from "./match-session-guards";
import { buildRoomReconnectKey, getPublicRoomStartCondition, isRoomReadyToStart, selectNextRoomHost } from "./rooms/lifecycle";
import { selectRankedText } from "./anti-cheat/text-selection";
import { createGatewayMetrics, type GatewayMetrics } from "./observability/metrics";
import { MatchCache } from "./match-cache";
import { MatchRepository } from "./match-repository";
import { createInitialLiveState, type MatchLiveState } from "./match-live-state";
import { startAiSimulationAdaptive } from "./ai-simulation";
import { UserCache } from "./user-cache";
import { sanitizeAvatarUrl, sanitizeDisplayName, sanitizeRoomCode, sanitizeUserAgent } from "../../../src/lib/sanitize";
import { PVP_ERROR_CODES, type PvpErrorPayload } from "../../../src/features/pvp/shared/error-codes";
import { gatewayLogger } from "../../../src/log/gatewayLogger";
import { canJoinPvpMatchSocket, isTerminalPvpMatchStatus } from "../../../src/features/pvp/server/match-access";
import { getPvpRankInfo } from "../../../src/features/pvp/rank";

const IS_PROD = process.env.NODE_ENV === "production";
const TRUST_PROXY_TLS = envBool("PVP_TRUST_PROXY_TLS", false);
const INSECURE_LOCALHOST = envBool("PVP_INSECURE_LOCALHOST", false);
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
const MATCH_DELTA_BUFFER_LIMIT = envInt("PVP_MATCH_DELTA_BUFFER_LIMIT", 12);
const MATCH_RESULT_RETENTION_MS = envMs("PVP_MATCH_RESULT_RETENTION_MS", 5 * 60 * 1000);
const MATCH_SWEEP_INTERVAL_MS = envMs("PVP_MATCH_SWEEP_INTERVAL_MS", 30_000);
const MATCH_MAX_COUNTDOWN_AGE_MS = envMs("PVP_MATCH_MAX_COUNTDOWN_AGE_MS", 2 * 60 * 1000);
const MATCH_MAX_LIVE_AGE_MS = envMs("PVP_MATCH_MAX_LIVE_AGE_MS", 30 * 60 * 1000);
const MATCH_NO_SHOW_TIMEOUT_MS = envMs("PVP_MATCH_NO_SHOW_TIMEOUT_MS", 40_000);
const ONLINE_KEY_PREFIX = "pvp:online:";
const ROOM_INACTIVITY_TTL_MS = envMs("PVP_ROOM_INACTIVITY_TTL_MS", 60 * 60 * 1000);
const ROOM_RECONNECT_GRACE_MS = envMs("PVP_ROOM_RECONNECT_GRACE_MS", 30_000);
const ROOM_SWEEP_INTERVAL_MS = envMs("PVP_ROOM_SWEEP_INTERVAL_MS", 2_000);
const PUBLIC_ROOM_AUTO_START_MS = envMs("PVP_PUBLIC_ROOM_AUTO_START_MS", 50_000);
const RANKED_MATCH_START_DELAY_MS = envMs("PVP_RANKED_MATCH_START_DELAY_MS", 3_000);
const ROOM_MATCH_START_DELAY_MS = envMs("PVP_ROOM_MATCH_START_DELAY_MS", 3_000);
const ROOM_SWEEP_LOCK_KEY = "pvp:room:sweep:lock";
const matchFinalizationLocks = new Set<string>();
const matchCleanupTimers = new Map<string, NodeJS.Timeout>();
const participantMetricAccumulators = new Map<string, { correctChars: number; mismatchChars: number }>();
let hasPvpMatchmakingPreferenceTable: boolean | null = null;
let pvpMatchmakingPreferenceTableLastCheckedAt = 0;
let hasLoggedMissingPvpMatchmakingPreferenceTableWarning = false;
const PVP_PREFERENCE_TABLE_RETRY_MS = 60_000;

function gatewayLogDebug(message: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  gatewayLogger.debug(`[PVP-GATEWAY] ${message}`, meta);
}

function gatewayLogInfo(message: string, meta?: Record<string, unknown>) {
  gatewayLogger.info(`[PVP-GATEWAY] ${message}`, meta);
}

function gatewayLogWarn(message: string, meta?: Record<string, unknown>) {
  gatewayLogger.warn(`[PVP-GATEWAY] ${message}`, meta);
}

function isMissingPvpMatchmakingPreferenceTable(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2021") return false;

  const table = String(error.meta?.table ?? "").toLowerCase();
  return table.includes("pvp_matchmaking_preference");
}

function logMissingGatewayPreferenceTableOnce() {
  if (hasLoggedMissingPvpMatchmakingPreferenceTableWarning) return;

  hasLoggedMissingPvpMatchmakingPreferenceTableWarning = true;
  gatewayLogWarn("Using default matchmaking preferences because the preference table is missing", {
    migrationHint: "Run Prisma migrations to add pvp_matchmaking_preference",
  });
}

function gatewayLogError(message: string, error: unknown, meta?: Record<string, unknown>) {
  gatewayLogger.error(`[PVP-GATEWAY] ${message}`, error, meta);
}

class PvpClientVisibleError extends Error {
  readonly payload: PvpErrorPayload;

  constructor(payload: PvpErrorPayload) {
    super(payload.message);
    this.name = "PvpClientVisibleError";
    this.payload = payload;
  }
}

function buildQueueError(payload: PvpErrorPayload) {
  return new PvpClientVisibleError(payload);
}

function toClientErrorPayload(error: unknown, fallback?: Partial<PvpErrorPayload>): PvpErrorPayload {
  if (error instanceof PvpClientVisibleError) {
    return {
      ...error.payload,
      ...fallback,
      details: {
        ...error.payload.details,
        ...fallback?.details,
      },
    };
  }

  return {
    message: fallback?.message ?? (error instanceof Error ? error.message : "Unknown error"),
    code: fallback?.code,
    retryable: fallback?.retryable,
    details: fallback?.details,
  };
}

type WsConn = WebSocket & {
  connectionId?: string;
  user?: ConnectionUser & Pick<WsAuthContext, "tokenVersion" | "validAfter" | "issuedAt">;
  matchId?: string;
  matchSessionKey?: string;
  roomCode?: string;
  ip?: string;
  rl?: { general: TokenBucket; input: TokenBucket; roomAction: TokenBucket };
  rawMsgStrikes?: number;
  presenceInterval?: NodeJS.Timeout | null;
};

type Placement = {
  position: number;
  userId: string;
  username: string;
  wpm: number;
  accuracy: number;
  errors: number;
  timeMs: number;
};

type PendingInputUpdateBatch = {
  maxSeqByUser: Map<string, number>;
  enqueuedCount: number;
  firstEnqueuedAtMs: number;
};

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function envBool(name: string, fallback = false) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

function parseAllowedOrigins() {
  const raw = process.env.PVP_ALLOWED_ORIGINS;
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}

const allowedOrigins = parseAllowedOrigins();

if (IS_PROD && !allowedOrigins) {
  throw new Error("Missing PVP_ALLOWED_ORIGINS in production");
}

function originAllowed(origin: string | undefined | null) {
  if (!allowedOrigins) return true;
  if (!origin) return false;
  return allowedOrigins.has(origin);
}

function isLocalhostHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isLocalOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return isLocalhostHost(parsed.hostname);
  } catch {
    return false;
  }
}

function hasOnlyLocalOrigins() {
  if (!allowedOrigins || allowedOrigins.size === 0) return false;
  return Array.from(allowedOrigins).every(isLocalOrigin);
}

function isLoopbackAddress(remoteAddress: string | undefined) {
  if (!remoteAddress) return false;
  const normalized = remoteAddress.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:127.0.0.1")
  );
}

function getClientIp(req: http.IncomingMessage) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();

  return req.socket.remoteAddress ?? "unknown";
}

function createGatewayServer() {
  const healthHandler: http.RequestListener = (req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
    void (async () => {
      if (path === "/metrics") {
        setGatewayGauge("pvp_gateway_uptime_seconds", Number(process.uptime().toFixed(3)));
        setGatewayGauge("pvp_gateway_heap_used_bytes", process.memoryUsage().heapUsed);
        const body = gatewayMetrics ? await gatewayMetrics.renderMetrics() : renderGatewayMetrics();
        res.writeHead(200, {
          "Content-Type": gatewayMetrics?.register.contentType ?? "text/plain; version=0.0.4; charset=utf-8",
        });
        res.end(body);
        return;
      }

      if (path === "/health" || path === "/healthz") {
        const response = gatewayHealthController
          ? await gatewayHealthController.evaluate("health")
          : { statusCode: 200, body: { status: "ok", instanceId: INSTANCE_ID } };
        res.writeHead(response.statusCode, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(response.body));
        return;
      }

      if (path === "/ready") {
        const response = gatewayHealthController
          ? await gatewayHealthController.evaluate("ready")
          : { statusCode: 503, body: { status: "not_ready", instanceId: INSTANCE_ID } };
        res.writeHead(response.statusCode, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(response.body));
        return;
      }

      if (path === "/") {
        res.writeHead(200);
        res.end("pvp-gateway ok");
        return;
      }

      res.writeHead(404);
      res.end("not found");
    })().catch((error) => {
      gatewayLogError("Gateway probe handler failed", error, { path });
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end("internal error");
    });
  };

  if (!IS_PROD) {
    return http.createServer(healthHandler);
  }

  if (TRUST_PROXY_TLS) {
    gatewayLogInfo("Starting PvP gateway behind trusted TLS proxy", {
      trustProxyTls: true,
    });
    return http.createServer(healthHandler);
  }

  if (INSECURE_LOCALHOST) {
    if (!hasOnlyLocalOrigins()) {
      throw new Error("PVP_INSECURE_LOCALHOST requires all PVP_ALLOWED_ORIGINS values to be localhost/127.0.0.1");
    }

    gatewayLogWarn("Starting PvP gateway in insecure localhost mode", {
      insecureLocalhost: true,
      warning: "Development only. Disable PVP_INSECURE_LOCALHOST for deployed environments.",
    });
    return http.createServer(healthHandler);
  }

  const keyPath = process.env.PVP_TLS_KEY_PATH;
  const certPath = process.env.PVP_TLS_CERT_PATH;
  if (!keyPath || !certPath) {
    throw new Error("Missing PVP_TLS_KEY_PATH or PVP_TLS_CERT_PATH in production (or set PVP_TRUST_PROXY_TLS=1 behind a trusted proxy)");
  }

  return https.createServer(
    {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      ca: process.env.PVP_TLS_CA_PATH ? fs.readFileSync(process.env.PVP_TLS_CA_PATH) : undefined,
    },
    healthHandler
  );
}

function isSecureGatewayRequest(req: http.IncomingMessage) {
  if (!IS_PROD) return true;

  if (INSECURE_LOCALHOST && isLoopbackAddress(req.socket.remoteAddress)) {
    return true;
  }

  if ((req.socket as { encrypted?: boolean }).encrypted) return true;

  if (!TRUST_PROXY_TLS) return false;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto.split(",")[0]?.trim().toLowerCase() === "https";
  }

  return false;
}

function sendImmediate(ws: WsConn, type: ServerMessage["type"], payload: unknown) {
  try {
    const serialized = toJson({ type, payload });
    incrementGatewayMetric("pvp_ws_outbound_messages_total", { type, batching: "immediate" });
    gatewayMetrics?.recordWsMessage({ direction: "out", type });
    observeGatewayHistogram("pvp_ws_outbound_message_bytes", Buffer.byteLength(serialized, "utf8"), WS_MESSAGE_SIZE_BUCKETS, {
      type,
      batching: "immediate",
    });
    ws.send(serialized);
  } catch {
    // ignore
  }
}

function send(ws: WsConn, type: ServerMessage["type"], payload: unknown) {
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

function getAuthedSocketsForUser(wss: WebSocketServer, userId: string) {
  const conns: WsConn[] = [];
  wss.clients.forEach((client: WebSocket) => {
    const c = client as WsConn;
    if (!c.user) return;
    if (c.user.userId !== userId) return;
    if (c.readyState !== WebSocket.OPEN) return;
    conns.push(c);
  });
  return conns;
}

function sendToUser(wss: WebSocketServer, userId: string, type: ServerMessage["type"], payload: unknown) {
  if (redisBus) {
    void redisBus.publish(userChannel(userId), { type, payload });
    return;
  }
  for (const c of getAuthedSocketsForUser(wss, userId)) {
    send(c, type, payload);
  }
}

function broadcastRoom(wss: WebSocketServer, roomCode: string, type: ServerMessage["type"], payload: unknown) {
  if (redisBus) {
    void redisBus.publish(roomChannel(roomCode), { type, payload });
    return;
  }
  wss.clients.forEach((client: WebSocket) => {
    const c = client as WsConn;
    if (c.roomCode !== roomCode) return;
    send(c, type, payload);
  });
}

function broadcastMatch(wss: WebSocketServer, matchId: string, type: ServerMessage["type"], payload: unknown) {
  void wss;
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

function getDisconnectForfeitKey(matchId: string, userId: string) {
  return `${matchId}:${userId}`;
}

function getParticipantMetricKey(matchId: string, userId: string) {
  return `${matchId}:${userId}`;
}

function clearParticipantMetricAccumulator(matchId: string, userId: string) {
  participantMetricAccumulators.delete(getParticipantMetricKey(matchId, userId));
}

function clearMatchMetricAccumulators(matchId: string) {
  for (const key of participantMetricAccumulators.keys()) {
    if (!key.startsWith(`${matchId}:`)) continue;
    participantMetricAccumulators.delete(key);
  }
}

function computeWpmFromCorrectChars(correctChars: number, startedAtMs: number, nowMs: number) {
  const elapsedMs = Math.max(1, nowMs - startedAtMs);
  const minutes = elapsedMs / 60000;
  const base = (correctChars / 5) / Math.max(minutes, 0.016667);
  return Math.max(0, Math.min(500, Math.round(base)));
}

function getOrInitParticipantAccumulator(matchId: string, textSnapshot: string, participant: InMemoryState["matches"] extends Map<string, infer T> ? T extends { participants: Map<string, infer P> } ? P : never : never) {
  const key = getParticipantMetricKey(matchId, participant.userId);
  const existing = participantMetricAccumulators.get(key);
  if (existing) return existing;

  let correctChars = 0;
  let mismatchChars = 0;
  const input = participant.input ?? "";
  const n = Math.min(input.length, textSnapshot.length);
  for (let i = 0; i < n; i += 1) {
    if (input[i] === textSnapshot[i]) {
      correctChars += 1;
    } else {
      mismatchChars += 1;
    }
  }

  const accumulator = { correctChars, mismatchChars };
  participantMetricAccumulators.set(key, accumulator);
  return accumulator;
}

/**
 * Updates participant metrics in O(delta) for append/backspace edits.
 */
function updateParticipantMetricsIncremental(params: {
  matchId: string;
  textSnapshot: string;
  participant: InMemoryState["matches"] extends Map<string, infer T> ? T extends { participants: Map<string, infer P> } ? P : never : never;
  nextInput: string;
  nowMs: number;
  startedAtMs: number;
}) {
  const { matchId, textSnapshot, participant, nextInput, nowMs, startedAtMs } = params;
  const previousInput = participant.input;
  const accumulator = getOrInitParticipantAccumulator(matchId, textSnapshot, participant);

  if (nextInput.length >= previousInput.length) {
    for (let position = previousInput.length; position < nextInput.length; position += 1) {
      if (nextInput[position] === textSnapshot[position]) {
        accumulator.correctChars += 1;
      } else {
        accumulator.mismatchChars += 1;
      }
    }
  } else {
    for (let position = nextInput.length; position < previousInput.length; position += 1) {
      if (previousInput[position] === textSnapshot[position]) {
        accumulator.correctChars = Math.max(0, accumulator.correctChars - 1);
      } else {
        accumulator.mismatchChars = Math.max(0, accumulator.mismatchChars - 1);
      }
    }
  }

  participant.input = nextInput;
  participant.errors = accumulator.mismatchChars;
  participant.accuracy = nextInput.length === 0
    ? 100
    : Math.max(0, Math.min(100, Number(((accumulator.correctChars / Math.max(1, nextInput.length)) * 100).toFixed(1))));
  participant.wpm = computeWpmFromCorrectChars(accumulator.correctChars, startedAtMs, nowMs);

  return accumulator;
}

function buildLiveStateFromLocalMatch(match: InMemoryState["matches"] extends Map<string, infer T> ? T : never): MatchLiveState {
  const participants: MatchLiveState["participants"] = {};

  for (const participant of match.participants.values()) {
    const accumulator = getOrInitParticipantAccumulator(match.matchId, match.textSnapshot, participant);
    participants[participant.userId] = {
      userId: participant.userId,
      username: participant.username,
      avatar: participant.avatar,
      slot: participant.slot,
      input: participant.input,
      seq: participant.seq,
      errors: participant.errors,
      wpm: participant.wpm,
      accuracy: participant.accuracy,
      finishedAt: participant.finishedAt,
      lastInputAtMs: participant.lastInputAtMs ?? null,
      correctChars: accumulator.correctChars,
      mismatchChars: accumulator.mismatchChars,
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
    deltas: match.recentDeltas ?? [],
  };
}

function appendMatchDelta(
  match: InMemoryState["matches"] extends Map<string, infer T> ? T : never,
  delta: {
    type: "PROGRESS" | "MATCH_STATE";
    payload: unknown;
    atMs: number;
  }
) {
  if (!match.recentDeltas) {
    match.recentDeltas = [];
  }

  match.recentDeltas.push({
    revision: match.revision,
    type: delta.type,
    payload: delta.payload,
    atMs: delta.atMs,
  });

  if (match.recentDeltas.length > MATCH_DELTA_BUFFER_LIMIT) {
    match.recentDeltas.splice(0, match.recentDeltas.length - MATCH_DELTA_BUFFER_LIMIT);
  }
}

async function tryBeginMatchFinalizationWithDbLock(params: {
  prisma: PrismaClient;
  match: InMemoryState["matches"] extends Map<string, infer T> ? T : never;
}) {
  const repository = new MatchRepository(params.prisma);

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
  prisma: PrismaClient;
  matchId: string;
  status: "FINISHED" | "ABORTED";
}) {
  const repository = new MatchRepository(params.prisma);

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

function tryBeginMatchFinalization(matchId: string) {
  if (matchFinalizationLocks.has(matchId)) return false;
  matchFinalizationLocks.add(matchId);
  return true;
}

function endMatchFinalization(matchId: string) {
  matchFinalizationLocks.delete(matchId);
}

function clearScheduledMatchCleanup(matchId: string) {
  const existing = matchCleanupTimers.get(matchId);
  if (!existing) return;
  clearTimeout(existing);
  matchCleanupTimers.delete(matchId);
}

function scheduleMatchCleanup(state: InMemoryState, matchId: string, delayMs = MATCH_RESULT_RETENTION_MS) {
  clearScheduledMatchCleanup(matchId);
  const match = state.matches.get(matchId);
  if (!match) return;

  match.cleanupScheduledAtMs = Date.now() + delayMs;
  const timer = setTimeout(() => {
    clearScheduledMatchCleanup(matchId);
    state.clearAiInterval(matchId);
    state.matches.delete(matchId);
    matchCache?.clearMatch(matchId);
    clearMatchMetricAccumulators(matchId);
  }, delayMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  matchCleanupTimers.set(matchId, timer);
}

function maybeBroadcastMatchSnapshot(wss: WebSocketServer, match: InMemoryState["matches"] extends Map<string, infer T> ? T : never, nowMs: number, intervalMs: number) {
  if (!shouldBroadcastPeriodicMatchSnapshot(match, nowMs, intervalMs)) return false;
  markMatchSnapshotBroadcast(match, nowMs);
  incrementGatewayMetric("pvp_match_snapshots_total", { state: match.state });
  const payload = buildMatchStatePayload(match, nowMs);
  appendMatchDelta(match, {
    type: "MATCH_STATE",
    payload,
    atMs: nowMs,
  });
  broadcastMatch(wss, match.matchId, "MATCH_STATE", payload);
  return true;
}

function envMs(name: string, fallbackMs: number) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallbackMs;
}

function createInputNonce() {
  return crypto.randomBytes(16).toString("hex");
}

function isAiUserId(userId: string) {
  return userId.startsWith("ai:");
}

function findActiveMatchByUserId(state: InMemoryState, userId: string) {
  for (const match of state.matches.values()) {
    if (!match.participants.has(userId)) continue;
    if (match.state === "finished" || match.state === "aborted") continue;
    return match;
  }
  return null;
}

function applyMatchTransition(params: {
  match: InMemoryState["matches"] extends Map<string, infer T> ? T : never;
  nextState: MatchLifecycleState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  reason?: "completed" | "opponent_disconnected" | "aborted";
}) {
  const { match, nextState, eventBus } = params;
  const from = match.state;

  try {
    const transitioned = transitionMatchState(match, nextState);
    match.state = transitioned.state;
    match.stateChangedAt = transitioned.stateChangedAt;
    match.status = matchStateToLegacyStatus(transitioned.state);
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

async function loadIdempotencyHit(params: {
  redis: RedisBus["redis"] | null;
  store: InMemoryIdempotencyStore;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  userId: string;
  messageType: string;
  requestId?: string;
}) {
  if (!params.requestId) return null;
  const key = buildIdempotencyKey(params.userId, params.messageType, params.requestId);
  const record = await getIdempotencyRecord({
    redis: params.redis,
    store: params.store,
    key,
  });
  params.eventBus.emit(record ? "idempotency:hit" : "idempotency:miss", {
    scope: params.messageType.toLowerCase(),
    userId: params.userId,
  });
  return { key, record };
}

async function storeIdempotencyHit(params: {
  redis: RedisBus["redis"] | null;
  store: InMemoryIdempotencyStore;
  key?: string;
  messageType: string;
  value: IdempotencyRecord;
}) {
  if (!params.key) return;
  await setIdempotencyRecord({
    redis: params.redis,
    store: params.store,
    key: params.key,
    value: params.value,
    ttlSeconds: getIdempotencyTtlSeconds(params.messageType),
  });
}

function nextRoomExpiryDate() {
  return new Date(Date.now() + ROOM_INACTIVITY_TTL_MS);
}

async function touchRoomExpiry(prisma: PrismaClient, roomId: string) {
  await prisma.pvpRoom.update({
    where: { id: roomId },
    data: { expiresAt: nextRoomExpiryDate() },
  });
}

function extractAverageWpm(longTermStats: unknown) {
  if (!longTermStats || typeof longTermStats !== "object") return null;

  const averageWpm = (longTermStats as Record<string, unknown>).averageWPM;
  if (typeof averageWpm !== "number" || !Number.isFinite(averageWpm)) {
    return null;
  }

  return Math.max(0, Math.round(averageWpm));
}

function buildMatchFoundPlayerPayload(user: Pick<ConnectionUser, "userId" | "username" | "avatar" | "pvpRating" | "rankTier" | "averageWpm"> & { slot: number }) {
  return {
    userId: user.userId,
    username: user.username,
    avatar: user.avatar,
    slot: user.slot,
    rating: user.pvpRating,
    rankTier: user.rankTier,
    averageWpm: user.averageWpm ?? null,
  };
}

async function loadRoomStatePayload(prisma: PrismaClient, roomCode: string) {
  const room = await prisma.pvpRoom.findUnique({
    where: { code: roomCode },
    select: {
      id: true,
      code: true,
      status: true,
      visibility: true,
      minPlayers: true,
      maxPlayers: true,
      hostUserId: true,
      autoStartAt: true,
      expiresAt: true,
      members: {
        where: { leftAt: null },
        orderBy: { joinedAt: "asc" },
        select: {
          userId: true,
          colorSlot: true,
          readyAt: true,
          joinedAt: true,
          leftAt: true,
          user: { select: { username: true, profile: { select: { avatar: true } } } },
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

async function broadcastRoomState(prisma: PrismaClient, wss: WebSocketServer, roomCode: string) {
  const payload = await loadRoomStatePayload(prisma, roomCode);
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

async function transferRoomHostIfNeeded(prisma: PrismaClient, roomId: string) {
  const room = await prisma.pvpRoom.findUnique({
    where: { id: roomId },
    select: {
      hostUserId: true,
      members: {
        orderBy: { joinedAt: "asc" },
        select: {
          userId: true,
          joinedAt: true,
          readyAt: true,
          leftAt: true,
        },
      },
    },
  });
  if (!room) return null;

  const nextHostUserId = selectNextRoomHost(room.members, room.hostUserId);
  if (!nextHostUserId || nextHostUserId === room.hostUserId) return nextHostUserId;

  await prisma.pvpRoom.update({
    where: { id: roomId },
    data: { hostUserId: nextHostUserId },
  });
  return nextHostUserId;
}

async function tryAcquireRoomSweepLock() {
  const redis = redisBus?.redis ?? null;
  if (!redis) return true;
  const token = `${INSTANCE_ID}:${Date.now()}`;
  const acquired = await redis.set(ROOM_SWEEP_LOCK_KEY, token, "EX", 10, "NX");
  return acquired === "OK";
}

async function sweepRoomLifecycle(
  prisma: PrismaClient,
  wss: WebSocketServer,
  onPublicRoomReady?: (roomCode: string) => Promise<unknown>
) {
  const redis = redisBus?.redis ?? null;
  const acquired = await tryAcquireRoomSweepLock();
  if (!acquired) return;

  const now = Date.now();
  const rooms = await prisma.pvpRoom.findMany({
    where: {
      OR: [{ status: "OPEN" }, { expiresAt: { lte: new Date(now) } }],
    },
    select: {
      id: true,
      code: true,
      status: true,
      visibility: true,
      minPlayers: true,
      maxPlayers: true,
      autoStartAt: true,
      expiresAt: true,
      hostUserId: true,
      members: {
        orderBy: { joinedAt: "asc" },
        select: {
          userId: true,
          joinedAt: true,
          readyAt: true,
          leftAt: true,
        },
      },
    },
  });

  for (const room of rooms) {
    if (room.expiresAt && room.expiresAt.getTime() <= now) {
      broadcastRoom(wss, room.code, "ERROR", { message: "Room expired" });
      await prisma.pvpRoom.delete({ where: { id: room.id } }).catch(() => null);
      continue;
    }

    let changed = false;
    for (const member of room.members) {
      if (member.leftAt) continue;
      const reconnectKey = buildRoomReconnectKey(room.id, member.userId);
      const hasReconnectLease = redis ? (await redis.exists(reconnectKey)) === 1 : false;
      const isOnline = redis ? (await redis.exists(`${ONLINE_KEY_PREFIX}${member.userId}`)) === 1 : getAuthedSocketsForUser(wss, member.userId).length > 0;
      if (isOnline || hasReconnectLease) continue;

      await prisma.pvpRoomMember.update({
        where: { roomId_userId: { roomId: room.id, userId: member.userId } },
        data: { leftAt: new Date() },
      });
      changed = true;
    }

    if (changed) {
      await transferRoomHostIfNeeded(prisma, room.id);
      await broadcastRoomState(prisma, wss, room.code);
    }

    if (room.visibility === "PUBLIC") {
      await onPublicRoomReady?.(room.code);
    }
  }
}

async function restoreRoomAfterMatch(prisma: PrismaClient, wss: WebSocketServer, roomCode: string) {
  const room = await prisma.pvpRoom.findUnique({
    where: { code: roomCode },
    select: { id: true, code: true, status: true, visibility: true, maxPlayers: true },
  });
  if (!room) return;

  await prisma.$transaction([
    prisma.pvpRoom.update({
      where: { id: room.id },
      data: {
        status: "OPEN",
        autoStartAt: room.visibility === "PUBLIC" ? new Date(Date.now() + PUBLIC_ROOM_AUTO_START_MS) : null,
        expiresAt: nextRoomExpiryDate(),
      },
    }),
    prisma.pvpRoomMember.updateMany({
      where: { roomId: room.id, leftAt: null },
      data: { readyAt: null },
    }),
  ]);

  await broadcastRoomState(prisma, wss, roomCode);
}

async function finalizeMatchResults(params: {
  prisma: PrismaClient;
  wss: WebSocketServer;
  state: InMemoryState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  matchId: string;
  placements: Placement[];
  reason: "completed" | "opponent_disconnected" | "aborted";
}) {
  const match = params.state.matches.get(params.matchId);
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;

  const dbLock = await tryBeginMatchFinalizationWithDbLock({
    prisma: params.prisma,
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

  await params.prisma.pvpMatch.update({
    where: { id: match.matchId },
    data: {
      status: matchStateToDbStatus("finished"),
      startedAt: new Date(match.serverStartAtMs),
      endedAt: new Date(),
    },
  });

  await Promise.all(
    params.placements
      .filter((placement) => !isAiUserId(placement.userId))
      .map((placement) =>
        params.prisma.pvpParticipant
          .update({
            where: {
              matchId_userId: {
                matchId: match.matchId,
                userId: placement.userId,
              },
            },
            data: {
              finalWpm: placement.wpm,
              finalAccuracy: placement.accuracy,
              finalErrors: placement.errors,
              timeSpentSec: Math.max(0, Math.floor(placement.timeMs / 1000)),
              completedAt: new Date(match.serverStartAtMs + placement.timeMs),
              ...(params.reason === "opponent_disconnected" && match.forfeitedUserId === placement.userId
                ? { disconnectCount: { increment: 1 } }
                : {}),
            },
          })
          .catch(() => null)
      )
  );

  let ratingChanges: Array<{ userId: string; before: number; after: number; delta: number }> = [];

  const ai = params.placements.find((p) => isAiUserId(p.userId)) ?? null;
  const humans = params.placements.filter((p) => !isAiUserId(p.userId));

  if (match.roomCode === null && params.placements.length === 2 && humans.length === 1 && ai) {
    const humanId = humans[0]!.userId;
    const humanWon = params.placements[0]!.userId === humanId;

    const humanRow = await params.prisma.pvpRating.upsert({
      where: { userId: humanId },
      update: {},
      create: { userId: humanId },
    });

    const aiRating = ratingFromWpm(ai.wpm);
    const upd = updateElo1v1({
      a: { rating: humanRow.rating, deviation: humanRow.deviation },
      b: { rating: aiRating, deviation: 180 },
      aScore: humanWon ? 1 : 0,
    });

    await params.prisma.$transaction([
      params.prisma.pvpRating.update({
        where: { userId: humanId },
        data: {
          rating: upd.nextA.rating,
          deviation: upd.nextA.deviation,
          gamesPlayed: { increment: 1 },
        },
      }),
      params.prisma.pvpRatingChange.create({
        data: {
          matchId: match.matchId,
          userId: humanId,
          beforeRating: humanRow.rating,
          afterRating: upd.nextA.rating,
          delta: upd.deltaA,
        },
      }),
    ]);

    ratingChanges = [{ userId: humanId, before: humanRow.rating, after: upd.nextA.rating, delta: upd.deltaA }];
  } else if (match.roomCode === null && params.placements.length === 2 && humans.length === 2) {
    const winnerId = params.placements[0]!.userId;
    const loserId = params.placements[1]!.userId;

    const [winnerRow, loserRow] = await Promise.all([
      params.prisma.pvpRating.upsert({ where: { userId: winnerId }, update: {}, create: { userId: winnerId } }),
      params.prisma.pvpRating.upsert({ where: { userId: loserId }, update: {}, create: { userId: loserId } }),
    ]);

    const upd = updateElo1v1({
      a: { rating: winnerRow.rating, deviation: winnerRow.deviation },
      b: { rating: loserRow.rating, deviation: loserRow.deviation },
      aScore: 1,
    });

    await params.prisma.$transaction([
      params.prisma.pvpRating.update({
        where: { userId: winnerId },
        data: { rating: upd.nextA.rating, deviation: upd.nextA.deviation, gamesPlayed: { increment: 1 } },
      }),
      params.prisma.pvpRating.update({
        where: { userId: loserId },
        data: { rating: upd.nextB.rating, deviation: upd.nextB.deviation, gamesPlayed: { increment: 1 } },
      }),
      params.prisma.pvpRatingChange.createMany({
        data: [
          { matchId: match.matchId, userId: winnerId, beforeRating: winnerRow.rating, afterRating: upd.nextA.rating, delta: upd.deltaA },
          { matchId: match.matchId, userId: loserId, beforeRating: loserRow.rating, afterRating: upd.nextB.rating, delta: upd.deltaB },
        ],
        skipDuplicates: true,
      }),
    ]);

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
      prisma: params.prisma,
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
    prisma: params.prisma,
    matchId: match.matchId,
    status: "FINISHED",
  });
  matchCache?.clearMatch(match.matchId);
  clearMatchMetricAccumulators(match.matchId);
  scheduleMatchCleanup(params.state, match.matchId);

  if (match.roomCode) {
    await restoreRoomAfterMatch(params.prisma, params.wss, match.roomCode);
  }
}

async function finalizeMatchIfComplete(params: {
  prisma: PrismaClient;
  wss: WebSocketServer;
  state: InMemoryState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  matchId: string;
}) {
  const match = params.state.matches.get(params.matchId);
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;

  const all = Array.from(match.participants.values());
  const finished = all.filter((p0) => p0.finishedAt != null);
  if (finished.length < Math.max(2, all.length)) return;

  const placements: Placement[] = [...all]
    .sort((a, b) => (a.finishedAt! - b.finishedAt!))
    .map((p0, idx) => ({
      position: idx + 1,
      userId: p0.userId,
      username: p0.username,
      wpm: p0.wpm,
      accuracy: p0.accuracy,
      errors: p0.errors,
      timeMs: (p0.finishedAt ?? Date.now()) - match.serverStartAtMs,
    }));

  if (!tryBeginMatchFinalization(params.matchId)) return;

  try {
    await finalizeMatchResults({
      prisma: params.prisma,
      wss: params.wss,
      state: params.state,
      eventBus: params.eventBus,
      matchId: params.matchId,
      placements,
      reason: "completed",
    });
  } finally {
    endMatchFinalization(params.matchId);
  }
}

async function finalizeMatchByDisconnectForfeit(params: {
  prisma: PrismaClient;
  wss: WebSocketServer;
  state: InMemoryState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  matchId: string;
  forfeitedUserId: string;
}) {
  const match = params.state.matches.get(params.matchId);
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;
  if (!tryBeginMatchFinalization(params.matchId)) return;

  try {
    const outcome = buildDisconnectForfeitOutcome({
      match,
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
          prisma: params.prisma,
          wss: params.wss,
          state: params.state,
          eventBus: params.eventBus,
          matchId: match.matchId,
          placements: outcome.placements,
          reason: "opponent_disconnected",
        }),
    });
  } finally {
    endMatchFinalization(params.matchId);
  }
}

async function abortMatchLifecycle(params: {
  prisma: PrismaClient;
  wss: WebSocketServer;
  state: InMemoryState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  matchId: string;
  reasonMessage: string;
  reasonCode?: "aborted" | "no_show";
}) {
  const match = params.state.matches.get(params.matchId);
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;
  if (!tryBeginMatchFinalization(params.matchId)) return;

  const dbLock = await tryBeginMatchFinalizationWithDbLock({
    prisma: params.prisma,
    match,
  });
  if (!dbLock) {
    endMatchFinalization(params.matchId);
    return;
  }

  try {
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

    await params.prisma.pvpMatch.update({
      where: { id: match.matchId },
      data: {
        status: matchStateToDbStatus("aborted"),
        startedAt: reasonCode === "no_show" ? null : new Date(match.serverStartAtMs),
        endedAt: new Date(),
      },
    });

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
      prisma: params.prisma,
      matchId: match.matchId,
      status: "ABORTED",
    });
    matchCache?.clearMatch(match.matchId);
    clearMatchMetricAccumulators(match.matchId);
    scheduleMatchCleanup(params.state, match.matchId);

    if (match.roomCode) {
      await restoreRoomAfterMatch(params.prisma, params.wss, match.roomCode);
    }
  } finally {
    endMatchFinalization(params.matchId);
  }
}

async function main() {
  const PORT = envInt("PORT", 8787);
  const prisma = new PrismaClient();
  const matchRepository = new MatchRepository(prisma);
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

  const AI_QUEUE_TIMEOUT_MS = envMs("PVP_AI_QUEUE_TIMEOUT_MS", 25_000);
  const WS_PING_INTERVAL_MS = envInt("PVP_WS_PING_INTERVAL_MS", 15_000);
  const DEV = process.env.NODE_ENV !== "production";
  const TEST_FORCE_BOT_MATCH = DEV && envBool("PVP_TEST_FORCE_BOT_MATCH", false);
  const ENABLE_PROMETHEUS_METRICS = envBool("PVP_PROMETHEUS_METRICS_ENABLED", true);
  const WS_SOFT_CONNECTION_LIMIT = envInt("PVP_WS_SOFT_CONNECTION_LIMIT", 1_000);
  const SHUTDOWN_GRACE_MS = envMs("PVP_GRACEFUL_SHUTDOWN_TIMEOUT_MS", 30_000);
  const USE_REDIS = envBool("PVP_USE_REDIS", false);
  const REDIS_URL = process.env.PVP_REDIS_URL ?? process.env.REDIS_URL ?? null;
  const INPUT_UPDATE_FLUSH_INTERVAL_MS = envMs("PVP_INPUT_UPDATE_FLUSH_INTERVAL_MS", 100);
  const INPUT_UPDATE_FLUSH_MAX_ENQUEUED = envInt("PVP_INPUT_UPDATE_FLUSH_MAX_ENQUEUED", 32);

  const getActiveMatchCount = () => {
    let activeMatches = 0;
    for (const match of state.matches.values()) {
      if (match.state === "finished" || match.state === "aborted") continue;
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
    prisma,
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

  eventBus.on("match:finished", ({ reason }) => {
    if (reason === "opponent_disconnected") {
      gatewayMetrics?.incrementMatchResult("abandon");
      return;
    }
    if (reason === "aborted") {
      gatewayMetrics?.incrementMatchResult("timeout");
    }
  });

  let testBot: ConnectionUser | null = null;
  async function ensureTestBot(): Promise<ConnectionUser> {
    if (testBot) return testBot;
    const botEmail = process.env.PVP_TEST_BOT_EMAIL ?? "pvp_test_bot@local.test";
    const botUsername = process.env.PVP_TEST_BOT_USERNAME ?? "pvp_test_bot";

    const user = await prisma.user.upsert({
      where: { email: botEmail },
      update: {},
      create: {
        email: botEmail,
        username: botUsername,
        passwordHash: null,
      },
      select: { id: true, username: true, profile: { select: { avatar: true } } },
    });

    const rating = await prisma.pvpRating.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
      select: { rating: true, deviation: true },
    });

    testBot = {
      userId: user.id,
      username: user.username,
      avatar: user.profile?.avatar ?? null,
      pvpRating: rating.rating,
      pvpDeviation: rating.deviation,
    };
    return testBot;
  }

  const server = createGatewayServer();

  const WS_MAX_PAYLOAD_BYTES = envInt("PVP_WS_MAX_PAYLOAD_BYTES", 64 * 1024);
  const WS_MAX_MSG_PER_SEC = envInt("PVP_WS_MAX_MSG_PER_SEC", 40);
  const WS_MAX_MSG_BURST = envInt("PVP_WS_MAX_MSG_BURST", 80);
  const WS_MAX_INPUT_MSG_PER_SEC = envInt("PVP_WS_MAX_INPUT_MSG_PER_SEC", 25);
  const WS_MAX_INPUT_MSG_BURST = envInt("PVP_WS_MAX_INPUT_MSG_BURST", 50);
  const WS_MAX_CONNECTIONS_PER_IP = envInt("PVP_WS_MAX_CONNECTIONS_PER_IP", 5);
  const WS_CONNECTION_ATTEMPTS_PER_MIN = envInt("PVP_WS_CONNECTION_ATTEMPTS_PER_MIN", 20);
  const WS_CONNECTION_ATTEMPTS_BURST = envInt("PVP_WS_CONNECTION_ATTEMPTS_BURST", 10);
  const WS_GLOBAL_CONNECTIONS_PER_SEC = envInt("PVP_WS_GLOBAL_CONNECTIONS_PER_SEC", 0);
  const WS_GLOBAL_CONNECTIONS_BURST = envInt("PVP_WS_GLOBAL_CONNECTIONS_BURST", 200);
  const WS_TICK_MS = envMs("PVP_WS_TICK_MS", 60);
  const MATCH_SNAPSHOT_INTERVAL_MS = envMs("PVP_MATCH_SNAPSHOT_INTERVAL_MS", 2_000);
  const ROOM_ACTION_COOLDOWN_MS = envMs("PVP_ROOM_ACTION_COOLDOWN_MS", 2_000);
  const CONNECTION_SPIKE_ALERT_THRESHOLD = envInt("PVP_WS_CONNECTION_SPIKE_ALERT_THRESHOLD", 30);
  const METRIC_SNAPSHOT_INTERVAL_MS = envMs("PVP_METRIC_SNAPSHOT_INTERVAL_MS", 5_000);

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
  const noShowTimers = new Map<string, NodeJS.Timeout>();
  const pendingInputUpdatesByMatch = new Map<string, PendingInputUpdateBatch>();
  let inputUpdateFlushInProgress = false;
  let inputUpdateFlushRequested = false;

  const getPendingInputQueueStats = () => {
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

  const enqueueInputUpdateBatch = (matchId: string, userId: string, seq: number) => {
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

  const mergePendingInputBatch = (matchId: string, batch: PendingInputUpdateBatch) => {
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

  const persistInputUpdateBatch = async (matchId: string, batch: PendingInputUpdateBatch) => {
    const match = state.matches.get(matchId);
    if (!match) {
      return;
    }

    const persistAtRevision = async (revisionToUse: number) => {
      const isTerminalState = match.state === "finished" || match.state === "aborted";
      return matchRepository.withTransaction(async (tx) => {
        return matchRepository.updateWithRevision(tx, match.matchId, {
          expectedRevision: revisionToUse,
          nextState: match.state,
          liveState: buildLiveStateFromLocalMatch(match),
          instanceId: INSTANCE_ID,
          serverStartAt: new Date(match.serverStartAtMs),
          startedAt: match.state === "waiting_for_both" ? null : new Date(match.serverStartAtMs),
          endedAt: isTerminalState ? new Date(match.stateChangedAt) : null,
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

      // If all pending seq values are already represented in DB, avoid redundant writes.
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

  const flushPendingInputUpdates = async (reason: "timer" | "threshold" | "shutdown") => {
    if (inputUpdateFlushInProgress) {
      inputUpdateFlushRequested = true;
      return;
    }

    if (pendingInputUpdatesByMatch.size === 0) {
      return;
    }

    inputUpdateFlushInProgress = true;
    const startedAt = Date.now();
    incrementGatewayMetric("pvp_input_update_flush_total", { reason });

    try {
      do {
        inputUpdateFlushRequested = false;
        const batches = Array.from(pendingInputUpdatesByMatch.entries());
        pendingInputUpdatesByMatch.clear();

        for (const [matchId, batch] of batches) {
          try {
            await persistInputUpdateBatch(matchId, batch);
          } catch (error) {
            // Requeue on transient failures to avoid dropping accepted local progress.
            mergePendingInputBatch(matchId, batch);
            incrementGatewayMetric("pvp_input_update_requeue_total", { reason });
            gatewayLogWarn("INPUT_UPDATE batch flush failed; requeued", {
              matchId,
              reason,
              enqueuedCount: batch.enqueuedCount,
              ageMs: Date.now() - batch.firstEnqueuedAtMs,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } while (inputUpdateFlushRequested && pendingInputUpdatesByMatch.size > 0);
    } finally {
      inputUpdateFlushInProgress = false;
      observeGatewayHistogram(
        "pvp_input_update_flush_duration_ms",
        Date.now() - startedAt,
        [5, 10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000],
        { reason }
      );
      gatewayLogDebug("INPUT_UPDATE flush cycle completed", {
        reason,
        durationMs: Date.now() - startedAt,
        pendingMatches: pendingInputUpdatesByMatch.size,
      });
    }
  };

  const inputUpdateFlushInterval = setInterval(() => {
    void flushPendingInputUpdates("timer");
  }, INPUT_UPDATE_FLUSH_INTERVAL_MS);

  const clearDisconnectForfeitTimer = (matchId: string, userId: string) => {
    const key = getDisconnectForfeitKey(matchId, userId);
    const existing = disconnectForfeitTimers.get(key);
    if (!existing) return;
    clearTimeout(existing);
    disconnectForfeitTimers.delete(key);
  };

  const clearNoShowTimer = (matchId: string) => {
    const existing = noShowTimers.get(matchId);
    if (!existing) return;
    clearTimeout(existing);
    noShowTimers.delete(matchId);
  };

  const isParticipantReadyForMatchStart = (matchId: string, userId: string) => {
    // Bot participants do not own websocket sessions, so they are immediately
    // considered ready once the server creates the local match state.
    if (isAiUserId(userId)) return true;

    const session = activeMatchSessions.get(`${matchId}:${userId}`);
    if (!session) return false;
    if (session.readyState !== WebSocket.OPEN) return false;
    if (session.matchId !== matchId) return false;
    return true;
  };

  const getReadyParticipantCount = (matchId: string, match: InMemoryState["matches"] extends Map<string, infer T> ? T : never) => {
    let ready = 0;
    for (const userId of match.participants.keys()) {
      if (!isParticipantReadyForMatchStart(matchId, userId)) continue;
      ready += 1;
    }
    return ready;
  };

  const getMatchOpponentType = (match: InMemoryState["matches"] extends Map<string, infer T> ? T : never) => {
    for (const userId of match.participants.keys()) {
      if (isAiUserId(userId)) return "bot" as const;
    }
    return "human" as const;
  };

  const maybeStartRankedCountdown = async (match: InMemoryState["matches"] extends Map<string, infer T> ? T : never) => {
    if (match.roomCode !== null) return false;
    if (match.state !== "waiting_for_both") return false;

    const readyCount = getReadyParticipantCount(match.matchId, match);
    if (readyCount < match.participants.size) return false;

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

    if (!lockResult.started) return false;

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
      sendToUser(wss, participant.userId, "MATCH_STATE", buildMatchStatePayload(match));
    }

    return true;
  };

  const scheduleNoShowTimeout = (matchId: string) => {
    clearNoShowTimer(matchId);

    const initialMatch = state.matches.get(matchId);
    if (initialMatch && Array.from(initialMatch.participants.keys()).some((userId) => isAiUserId(userId))) {
      return;
    }

    const timer = setTimeout(() => {
      noShowTimers.delete(matchId);
      const match = state.matches.get(matchId);
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

      void abortMatchLifecycle({
        prisma,
        wss,
        state,
        eventBus,
        matchId,
        reasonCode: "no_show",
        reasonMessage: "The opponent did not connect in time, so the match was cancelled.",
      }).catch(() => {
        // ignore
      });
    }, MATCH_NO_SHOW_TIMEOUT_MS);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    noShowTimers.set(matchId, timer);
  };

  const persistReconnectGraceWindow = async (matchId: string, userId: string, reconnectUntilMs: number) => {
    await matchRepository.withTransaction(async (tx) => {
      const locked = await matchRepository.loadForUpdate(tx, matchId);
      if (!locked) return;
      if (locked.status === "FINISHED" || locked.status === "ABORTED") return;

      const liveState =
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

  const scheduleDisconnectForfeit = (matchId: string, userId: string) => {
    clearDisconnectForfeitTimer(matchId, userId);
    const timer = setTimeout(() => {
      disconnectForfeitTimers.delete(getDisconnectForfeitKey(matchId, userId));
      const activeMatch = state.matches.get(matchId);
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

      void finalizeMatchByDisconnectForfeit({
        prisma,
        wss,
        state,
        eventBus,
        matchId,
        forfeitedUserId: userId,
      }).catch(() => {
        // ignore
      });
    }, DISCONNECT_FORFEIT_GRACE_MS);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    disconnectForfeitTimers.set(getDisconnectForfeitKey(matchId, userId), timer);
  };

  const createLockedHumanRematch = async (params: {
    sourceMatchId: string;
    users: Array<ConnectionUser & { slot: number }>;
    persistUserIds: string[];
  }) => {
    if (rematchStartedByMatchId.has(params.sourceMatchId)) {
      return false;
    }

    rematchStartedByMatchId.add(params.sourceMatchId);
    const created = await createRanked1v1Match({
      users: params.users,
      persistUserIds: params.persistUserIds,
      startDelayMs: RANKED_MATCH_START_DELAY_MS,
    });

    const sourceMatch = state.matches.get(params.sourceMatchId);
    if (sourceMatch) {
      sourceMatch.rematchMatchId = created.matchId;
    }

    return true;
  };

  const releaseMatchSession = (ws: WsConn) => {
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

  const claimMatchSession = (matchId: string, userId: string, ws: WsConn) => {
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

  const sweepStaleMatches = async () => {
    const now = Date.now();

    const staleDbRows = await prisma.pvpMatch.findMany({
      where: {
        OR: [
          {
            status: "PENDING",
            updatedAt: { lte: new Date(now - MATCH_NO_SHOW_TIMEOUT_MS) },
          },
          {
            status: "COUNTDOWN",
            updatedAt: { lte: new Date(now - MATCH_MAX_COUNTDOWN_AGE_MS) },
          },
          {
            status: "RUNNING",
            updatedAt: { lte: new Date(now - MATCH_MAX_LIVE_AGE_MS) },
          },
        ],
      },
      select: {
        id: true,
      },
      take: 100,
      orderBy: {
        updatedAt: "asc",
      },
    });

    for (const row of staleDbRows) {
      const markedStale = await matchRepository.withTransaction(async (tx) => {
        const locked = await matchRepository.loadForUpdate(tx, row.id);
        if (!locked) return false;

        const stateAgeMs = now - locked.updatedAt.getTime();
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

        const liveState = locked.liveState ?? {
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

      const local = state.matches.get(row.id);
      if (local) {
        for (const participant of local.participants.values()) {
          if (isAiUserId(participant.userId)) continue;
          sendToUser(wss, participant.userId, "MATCH_ENDED", {
            matchId: row.id,
            reason: "aborted",
            message: "This match was closed because the session became stale.",
            finalResultsPending: false,
          });
          clearDisconnectForfeitTimer(row.id, participant.userId);
          clearParticipantMetricAccumulator(row.id, participant.userId);
        }

        clearNoShowTimer(row.id);
        clearScheduledMatchCleanup(row.id);
        state.clearAiInterval(row.id);
        state.matches.delete(row.id);
      }

      matchCache?.clearMatch(row.id);
      clearMatchMetricAccumulators(row.id);
    }

    for (const [matchId, match] of state.matches.entries()) {
      if ((match.state === "finished" || match.state === "aborted") && match.finalizedAtMs && now - match.finalizedAtMs >= MATCH_RESULT_RETENTION_MS) {
        clearNoShowTimer(matchId);
        clearScheduledMatchCleanup(matchId);
        state.clearAiInterval(matchId);
        state.matches.delete(matchId);
        matchCache?.clearMatch(matchId);
        clearMatchMetricAccumulators(matchId);
        continue;
      }

      const staleReason = getStaleMatchAbortReason({
        state: match.state,
        stateAgeMs: now - match.stateChangedAt,
        maxCountdownAgeMs: MATCH_MAX_COUNTDOWN_AGE_MS,
        maxLiveAgeMs: MATCH_MAX_LIVE_AGE_MS,
      });

      if (staleReason) {
        gatewayLogWarn("Sweeping stale active match", { matchId, staleReason, state: match.state });
        clearNoShowTimer(matchId);
        for (const userId of match.participants.keys()) {
          clearDisconnectForfeitTimer(matchId, userId);
          clearParticipantMetricAccumulator(matchId, userId);
        }
        await abortMatchLifecycle({
          prisma,
          wss,
          state,
          eventBus,
          matchId,
          reasonMessage: staleReason === "stale_countdown" ? "This match expired before it could start." : "This match was closed because the session became stale.",
        });
      }
    }

    for (const [key, socket] of activeMatchSessions.entries()) {
      if (socket.readyState !== WebSocket.OPEN || !socket.user) {
        activeMatchSessions.delete(key);
      }
    }

    for (const matchId of rematchAcceptedByMatchId.keys()) {
      if (!state.matches.has(matchId)) {
        rematchAcceptedByMatchId.delete(matchId);
      }
    }
  };

  const staleMatchSweepInterval = setInterval(() => {
    void sweepStaleMatches().catch((error) => {
      gatewayLogError("Failed to sweep stale matches", error);
    });
  }, MATCH_SWEEP_INTERVAL_MS);
  if (typeof staleMatchSweepInterval.unref === "function") {
    staleMatchSweepInterval.unref();
  }

  const roomLifecycleSweepInterval = setInterval(() => {
    void sweepRoomLifecycle(prisma, wss, maybeAutoStartPublicRoom).catch((error) => {
      gatewayLogError("Failed to sweep room lifecycle", error);
    });
  }, ROOM_SWEEP_INTERVAL_MS);
  if (typeof roomLifecycleSweepInterval.unref === "function") {
    roomLifecycleSweepInterval.unref();
  }

  const snapshotGatewayMetrics = () => {
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
        wss.clients.forEach((client: WebSocket) => {
          const c = client as WsConn;
          if (c.roomCode !== roomCode) return;
          send(c, msg.type as ServerMessage["type"], msg.payload);
        });
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
local me = ARGV[1]
local minR = tonumber(ARGV[2])
local maxR = tonumber(ARGV[3])
local onlinePrefix = ARGV[4]

local myScore = redis.call('ZSCORE', KEYS[1], me)
if not myScore then
  return nil
end

local candidates = redis.call('ZRANGEBYSCORE', KEYS[1], minR, maxR, 'LIMIT', 0, 20)
for i = 1, #candidates do
  local other = candidates[i]
  if other ~= me then
    local online = redis.call('EXISTS', onlinePrefix .. other)
    if online == 1 then
      local r1 = redis.call('ZREM', KEYS[1], me)
      local r2 = redis.call('ZREM', KEYS[1], other)
      if r1 == 1 and r2 == 1 then
        return other
      else
        if r1 == 1 then
          redis.call('ZADD', KEYS[1], myScore, me)
        end
      end
    end
  end
end

return nil
`;

  type QueuedUserMeta = {
    bucketKey: string;
    joinedAtMs: number;
    preference: MatchmakingPreference;
    rating: number;
  };

  function getQueueMetaKey(userId: string) {
    return `${QUEUE_META_KEY_PREFIX}${userId}`;
  }

  async function markOnline(userId: string) {
    if (!redis) return;
    await redis.set(`${ONLINE_KEY_PREFIX}${userId}`, INSTANCE_ID, "EX", ONLINE_TTL_SEC);
  }

  async function readQueueMeta(userId: string): Promise<QueuedUserMeta | null> {
    if (!redis) return null;
    const raw = await redis.get(getQueueMetaKey(userId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as QueuedUserMeta;
    } catch {
      return null;
    }
  }

  async function queueLeave(userId: string) {
    if (!redis) return 0;
    const meta = await readQueueMeta(userId);
    if (!meta) return 0;

    const removed = await redis.zrem(meta.bucketKey, userId);
    await redis.del(getQueueMetaKey(userId));
    return removed;
  }

  async function queueJoin(user: ConnectionUser) {
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
    await redis.set(getQueueMetaKey(user.userId), JSON.stringify(meta), "EX", Math.ceil(AI_QUEUE_TIMEOUT_MS / 1000) + 120);
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
    const otherId = (await redis.eval(
      QUEUE_MATCH_LUA,
      1,
      me.bucketKey,
      user.userId,
      String(minR),
      String(maxR),
      ONLINE_KEY_PREFIX
    )) as string | null;
    if (!otherId || typeof otherId !== "string") return null;

    const other = await readQueueMeta(otherId);
    await redis.del(getQueueMetaKey(user.userId), getQueueMetaKey(otherId));
    return { otherId, me, other };
  }

  const AI_REMATCH_COOLDOWN_MS = envMs("PVP_AI_REMATCH_COOLDOWN_MS", 20 * 60 * 1000);
  const aiRematchRefuseUntilByHumanId = new Map<string, number>();
  const rematchAcceptedByMatchId = new Map<string, Set<string>>();

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
  }) => {
    const activeMembers = params.members.filter((member) => member.leftAt === null);
    if (activeMembers.length < 2) {
      return null;
    }

    const serverStartAtMs = Date.now() + (params.startDelayMs ?? ROOM_MATCH_START_DELAY_MS);
    const match = await prisma.pvpMatch.create({
      data: {
        status: "COUNTDOWN",
        roomId: params.roomId,
        textSnapshot: "placeholder",
        serverStartAt: new Date(serverStartAtMs),
      },
      select: { id: true },
    });

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
    });
    eventBus.emit("match:countdown", {
      matchId: match.id,
      from: "lobby",
      to: "countdown",
      roomCode: params.roomCode,
      atMs: local.stateChangedAt,
    });

    await prisma.pvpMatch.update({
      where: { id: match.id },
      data: { textSnapshot: local.textSnapshot },
    });

    await prisma.pvpParticipant.createMany({
      data: activeMembers.map((member) => ({
        matchId: match.id,
        userId: member.userId,
        slot: member.colorSlot,
      })),
      skipDuplicates: true,
    });

    await prisma.pvpRoom.update({
      where: { id: params.roomId },
      data: { status: "IN_MATCH", autoStartAt: null },
    });

    broadcastRoom(wss, params.roomCode, "MATCH_FOUND", {
      matchId: match.id,
      textSnapshot: local.textSnapshot,
      serverStartAt: new Date(serverStartAtMs).toISOString(),
      players: Array.from(local.participants.values()).map((participant) => ({
        userId: participant.userId,
        username: participant.username,
        avatar: participant.avatar,
        slot: participant.slot,
      })),
    });

    return { matchId: match.id, local, serverStartAtMs };
  };

  const maybeAutoStartPublicRoom = async (roomCode: string) => {
    const room = await prisma.pvpRoom.findUnique({
      where: { code: roomCode },
      select: {
        id: true,
        code: true,
        status: true,
        visibility: true,
        minPlayers: true,
        maxPlayers: true,
        autoStartAt: true,
        members: {
          where: { leftAt: null },
          orderBy: { joinedAt: "asc" },
          select: {
            userId: true,
            colorSlot: true,
            readyAt: true,
            leftAt: true,
            user: { select: { username: true, profile: { select: { avatar: true } } } },
          },
        },
      },
    });
    if (!room || room.status !== "OPEN" || room.visibility !== "PUBLIC") {
      return false;
    }

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

  async function loadConnectionUser(userId: string): Promise<ConnectionUser> {
    const cache = connectionUserCache;
    if (!cache) {
      throw new Error("User cache not initialized");
    }

    return cache.getOrLoad(userId, async () => {
      const shouldSkipPreferenceLookup =
        hasPvpMatchmakingPreferenceTable === false &&
        Date.now() - pvpMatchmakingPreferenceTableLastCheckedAt < PVP_PREFERENCE_TABLE_RETRY_MS;

      let user:
        | {
            username: string | null;
            banned: boolean;
            profile: { avatar: string | null; longTermStats?: unknown } | null;
            pvpRating: { rating: number; deviation: number } | null;
            pvpMatchmakingPreference?: {
              preferredMode: string;
            } | null;
          }
        | null;

      if (shouldSkipPreferenceLookup) {
        user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            username: true,
            banned: true,
            profile: { select: { avatar: true, longTermStats: true } },
            pvpRating: { select: { rating: true, deviation: true } },
          },
        });
      } else {
        try {
          user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
              username: true,
              banned: true,
              profile: { select: { avatar: true, longTermStats: true } },
              pvpRating: { select: { rating: true, deviation: true } },
              pvpMatchmakingPreference: {
                select: {
                  preferredMode: true,
                },
              },
            },
          });
          hasPvpMatchmakingPreferenceTable = true;
          pvpMatchmakingPreferenceTableLastCheckedAt = Date.now();
        } catch (error) {
          if (!isMissingPvpMatchmakingPreferenceTable(error)) {
            throw error;
          }

          hasPvpMatchmakingPreferenceTable = false;
          pvpMatchmakingPreferenceTableLastCheckedAt = Date.now();
          logMissingGatewayPreferenceTableOnce();
          user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
              username: true,
              banned: true,
              profile: { select: { avatar: true, longTermStats: true } },
              pvpRating: { select: { rating: true, deviation: true } },
            },
          });
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
          mode: user.pvpMatchmakingPreference?.preferredMode,
        }),
      };
    });
  }

  async function createRanked1v1Match(params: {
    users: Array<(ConnectionUser & { slot: number })>;
    persistUserIds: string[];
    startDelayMs?: number;
  }) {
    const matchId = crypto.randomUUID();
    const hasAiParticipant = params.users.some((user) => isAiUserId(user.userId));
    const initialState: MatchLifecycleState = hasAiParticipant ? "countdown" : "waiting_for_both";
    const initialDbStatus = hasAiParticipant ? "COUNTDOWN" : "PENDING";

    const rankedText = await selectRankedText({
      matchId,
      userIds: params.persistUserIds.filter((userId) => !isAiUserId(userId)),
      redis,
    });
    const inputNonce = createInputNonce();
    const liveState = createInitialLiveState({
      state: initialState,
      participants: params.users,
    });

    const serverStartAtMs = Date.now() + (params.startDelayMs ?? RANKED_MATCH_START_DELAY_MS);

    await prisma.$transaction(async (tx) => {
      await tx.pvpMatch.create({
        data: {
          id: matchId,
          status: initialDbStatus,
          textSnapshot: rankedText.textSnapshot,
          textId: rankedText.textId,
          inputNonce,
          serverStartAt: hasAiParticipant ? new Date(serverStartAtMs) : null,
          revision: 1,
          instanceId: INSTANCE_ID,
          liveState: liveState as unknown as Prisma.InputJsonValue,
        },
      });

      if (params.persistUserIds.length) {
        await tx.pvpParticipant.createMany({
          data: params.persistUserIds.map((userId) => ({
            matchId,
            userId,
            slot: params.users.find((u) => u.userId === userId)?.slot ?? 0,
          })),
          skipDuplicates: true,
        });
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
    });

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

    return { matchId, local, serverStartAtMs, payload };
  }

  const resendExistingRematch = (matchId: string, userId: string) => {
    const rematch = state.matches.get(matchId);
    if (!rematch) return false;

    sendToUser(wss, userId, "MATCH_FOUND", {
      matchId: rematch.matchId,
      textSnapshot: rematch.textSnapshot,
      textId: rematch.textId,
      inputNonce: rematch.inputNonce,
      serverStartAt: new Date(rematch.serverStartAtMs).toISOString(),
      players: Array.from(rematch.participants.values()).map((participant) => ({
        userId: participant.userId,
        username: participant.username,
        avatar: participant.avatar,
        slot: participant.slot,
      })),
    });

    return true;
  };

  wss.on("connection", (ws: WsConn, req: http.IncomingMessage) => {
    ws.connectionId = crypto.randomUUID();

    if (!gatewayHealthController?.canAcceptTraffic()) {
      gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "gateway_not_ready" });
      ws.close(1013, "Gateway not ready");
      return;
    }

    if (!isSecureGatewayRequest(req)) {
      gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "insecure_transport" });
      ws.close(1008, "Secure websocket required");
      return;
    }

    if (!originAllowed(req.headers.origin)) {
      gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "origin_not_allowed" });
      ws.close(1008, "Origin not allowed");
      return;
    }

    const ip = getClientIp(req);
    ws.ip = ip;

    if (globalConnectionBucket && !tryConsume(globalConnectionBucket, 1, Date.now())) {
      gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "global_connection_rate_limit" });
      ws.close(1013, "Gateway busy");
      return;
    }

    gatewayLogDebug("Incoming websocket connection", {
      ip,
      origin: req.headers.origin ?? null,
      userAgent: sanitizeUserAgent(req.headers["user-agent"] ?? null),
    });

    let attemptBucket = connectionAttemptBuckets.get(ip);
    if (!attemptBucket) {
      attemptBucket = createTokenBucket({
        capacity: WS_CONNECTION_ATTEMPTS_BURST,
        refillPerSec: WS_CONNECTION_ATTEMPTS_PER_MIN / 60,
        nowMs: Date.now(),
      });
      connectionAttemptBuckets.set(ip, attemptBucket);
    }

    if (!tryConsume(attemptBucket, 1, Date.now())) {
      gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "connection_attempt_rate_limit", ip });
      ws.close(1013, "Too many connection attempts");
      return;
    }

    const activeForIp = activeConnectionsByIp.get(ip) ?? 0;
    if (activeForIp >= WS_MAX_CONNECTIONS_PER_IP) {
      gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "connection_cap", ip });
      ws.close(1013, "Too many active connections");
      return;
    }
    activeConnectionsByIp.set(ip, activeForIp + 1);
    gatewayMetrics?.setConnectionsActive(wss.clients.size);

    const nextSpikeCount = incrementGatewayMetric("ws_connection_opened", { ip });
    if (nextSpikeCount >= CONNECTION_SPIKE_ALERT_THRESHOLD) {
      console.warn(`[pvp-gateway] abnormal connection spike detected for ${ip}: ${nextSpikeCount}`);
    }

    const connectedAtMs = Date.now();
    ws.rawMsgStrikes = 0;
    ws.rl = {
      general: createTokenBucket({ capacity: WS_MAX_MSG_BURST, refillPerSec: WS_MAX_MSG_PER_SEC, nowMs: connectedAtMs }),
      input: createTokenBucket({ capacity: WS_MAX_INPUT_MSG_BURST, refillPerSec: WS_MAX_INPUT_MSG_PER_SEC, nowMs: connectedAtMs }),
      roomAction: createTokenBucket({ capacity: 1, refillPerSec: 1000 / ROOM_ACTION_COOLDOWN_MS, nowMs: connectedAtMs }),
    };

    // Keepalive ping to avoid idle timeouts (~30s) killing the connection.
    const pingInterval =
      WS_PING_INTERVAL_MS > 0
        ? setInterval(() => {
            try {
              if (ws.readyState === WebSocket.OPEN) ws.ping();
            } catch {
              // ignore
            }
          }, WS_PING_INTERVAL_MS)
        : null;

    send(ws, "QUEUE_STATUS", { status: "CONNECTED" });

    ws.on("message", async (data: RawData) => {
      const messageStartedAt = process.hrtime.bigint();
      let metricMessageType = "unknown";
      const nowMs = Date.now();
      const byteLength =
        typeof data === "string"
          ? Buffer.byteLength(data, "utf8")
          : Buffer.isBuffer(data)
            ? data.length
            : data instanceof ArrayBuffer
              ? data.byteLength
              : ArrayBuffer.isView(data)
                ? data.byteLength
                : 0;

      if (byteLength > WS_MAX_PAYLOAD_BYTES) {
        incrementGatewayMetric("ws_validation_failed", { reason: "payload_too_large" });
        ws.close(1009, "Message too large");
        return;
      }

      if (ws.rl && !tryConsume(ws.rl.general, 1, nowMs)) {
        incrementGatewayMetric("ws_rate_limit_rejected", { reason: "general_message_rate" });
        ws.rawMsgStrikes = (ws.rawMsgStrikes ?? 0) + 1;
        if ((ws.rawMsgStrikes ?? 0) >= 3) {
          ws.close(1013, "Rate limit");
        }
        return;
      }

      const raw = typeof data === "string" ? data : data.toString("utf-8");
      const parsedMessage = safeParseClientMessage(raw);
      if (!parsedMessage.success) {
        incrementGatewayMetric("ws_validation_failed", { reason: parsedMessage.error });
        send(ws, "ERROR", { message: parsedMessage.error });
        return;
      }
      const msg = parsedMessage.data;
      metricMessageType = msg.type;
      incrementGatewayMetric("pvp_ws_inbound_messages_total", { type: msg.type });

      if (msg.type === "INPUT_UPDATE" && ws.rl && !tryConsume(ws.rl.input, 1, nowMs)) {
        incrementGatewayMetric("ws_rate_limit_rejected", { reason: "input_message_rate" });
        // Do not close immediately; ignore input spam.
        return;
      }

      try {
        if (msg.type === "HELLO") {
          const authed = await verifyWsTokenFast(msg.payload.token, {
            clientSecret: msg.payload.clientSecret,
            userAgent: sanitizeUserAgent(req.headers["user-agent"] ?? null),
          });
          ws.user = {
            userId: authed.userId,
            username: authed.username,
            avatar: authed.avatar,
            pvpRating: authed.pvpRating,
            pvpDeviation: authed.pvpDeviation,
            tokenVersion: authed.tokenVersion,
            validAfter: authed.validAfter,
            issuedAt: authed.issuedAt,
          };
          gatewayMetrics?.incrementWsHandshake("success");

          gatewayLogInfo("Websocket client authenticated", {
            userId: ws.user.userId,
            ip: ws.ip ?? "unknown",
          });

          await markOnline(ws.user.userId);
          if (redis) {
            ws.presenceInterval = setInterval(() => {
              if (!ws.user) return;
              void markOnline(ws.user.userId);
            }, PRESENCE_REFRESH_MS);
          }

          send(ws, "HELLO_OK", {
            user: {
              userId: ws.user.userId,
              username: ws.user.username,
              avatar: ws.user.avatar,
            },
          });
          return;
        }

        if (msg.type === "AUTH_REFRESH") {
          if (!ws.user) {
            send(ws, "ERROR", { message: "Unauthenticated" });
            return;
          }

          const refreshed = await verifyWsTokenStrict(msg.payload.token, {
            prisma,
            clientSecret: msg.payload.clientSecret,
            userAgent: sanitizeUserAgent(req.headers["user-agent"] ?? null),
            expectedUserId: ws.user.userId,
          });

          ws.user = {
            ...ws.user,
            username: refreshed.username,
            avatar: refreshed.avatar,
            pvpRating: refreshed.pvpRating,
            pvpDeviation: refreshed.pvpDeviation,
            tokenVersion: refreshed.tokenVersion,
            validAfter: refreshed.validAfter,
            issuedAt: refreshed.issuedAt,
          };

          await markOnline(ws.user.userId);
          gatewayLogDebug("Websocket auth refresh completed", {
            userId: ws.user.userId,
          });
          send(ws, "AUTH_REFRESH_OK", { expiresAt: Math.floor(Date.now() / 1000) + envInt("PVP_WS_TOKEN_TTL_SECONDS", 900) });
          return;
        }

        if (!ws.user) {
          send(ws, "ERROR", { message: "Unauthenticated" });
          return;
        }

        if (msg.type === "QUEUE_JOIN" || msg.type === "MATCH_JOIN") {
          await assertWsTokenState(prisma, {
            userId: ws.user.userId,
            username: ws.user.username,
            avatar: ws.user.avatar,
            pvpRating: ws.user.pvpRating,
            pvpDeviation: ws.user.pvpDeviation,
            tokenVersion: ws.user.tokenVersion,
            validAfter: ws.user.validAfter,
            issuedAt: ws.user.issuedAt,
          });
        }

        const idempotency = await loadIdempotencyHit({
          redis,
          store: idempotencyStore,
          eventBus,
          userId: ws.user.userId,
          messageType: msg.type,
          requestId: "requestId" in msg ? msg.requestId : undefined,
        });
        if (idempotency?.record) {
          if (idempotency.record.response) {
            send(ws, idempotency.record.response.type, idempotency.record.response.payload);
          }
          return;
        }

        if (msg.type === "QUEUE_JOIN") {
          const requestId = "requestId" in msg ? msg.requestId : undefined;
          const queueLogContext = {
            userId: ws.user.userId,
            requestId,
            connectionId: ws.connectionId,
            queueMode: redis ? "redis" : "local",
          };

          if (!gatewayHealthController?.canAcceptTraffic()) {
            gatewayLogWarn("Rejected ranked queue join because the gateway is draining", queueLogContext);
            send(ws, "ERROR", {
              code: PVP_ERROR_CODES.QUEUE_GATEWAY_DRAINING,
              message: "Gateway is draining",
              retryable: true,
              details: { requestId, phase: "queue_join_precondition" },
            });
            send(ws, "QUEUE_STATUS", { status: "IDLE" });
            return;
          }

          gatewayLogInfo("Ranked queue join requested", {
            ...queueLogContext,
            useRedis: Boolean(redis),
          });
          // Dev TEST: force a match vs a real DB-backed bot user (exercise human-vs-human path).
          if (TEST_FORCE_BOT_MATCH) {
            const bot = await ensureTestBot();
            const me = await loadConnectionUser(ws.user.userId);
            ws.user = {
              ...me,
              tokenVersion: ws.user.tokenVersion,
              validAfter: ws.user.validAfter,
              issuedAt: ws.user.issuedAt,
            };

            if (me.userId === bot.userId) {
              send(ws, "ERROR", { message: "TEST bot cannot match itself" });
              return;
            }

            state.removeFromQueue(me.userId);
            state.clearQueueTimeout(me.userId);

            const created = await createRanked1v1Match({
              users: [
                { ...me, slot: 0 },
                { ...bot, slot: 1 },
              ],
              persistUserIds: [me.userId, bot.userId],
              startDelayMs: RANKED_MATCH_START_DELAY_MS,
            });

            await startAiSimulationAdaptive({
              prisma,
              wss,
              matchCache,
              matchRepository,
              matchId: created.matchId,
              humanId: me.userId,
              aiUserId: bot.userId,
              snapshotIntervalMs: MATCH_SNAPSHOT_INTERVAL_MS,
              state,
              forceFinishHumanAfterMs: 0,
              onFinalizeMatchIfComplete: (matchId) =>
                finalizeMatchIfComplete({
                  prisma,
                  wss,
                  state,
                  eventBus,
                  matchId,
                }),
              onBroadcastMatchSnapshot: (matchId, nowMs, intervalMs) => {
                const liveMatch = state.matches.get(matchId);
                if (!liveMatch) return false;
                return maybeBroadcastMatchSnapshot(wss, liveMatch, nowMs, intervalMs);
              },
            });

            await storeIdempotencyHit({
              redis,
              store: idempotencyStore,
              key: idempotency?.key,
              messageType: msg.type,
              value: { response: { type: "MATCH_FOUND", payload: created.payload } },
            });

            return;
          }

          const me = await loadConnectionUser(ws.user.userId);
          ws.user = {
            ...me,
            tokenVersion: ws.user.tokenVersion,
            validAfter: ws.user.validAfter,
            issuedAt: ws.user.issuedAt,
          };
          await markOnline(me.userId);

          // Redis-backed queue + atomic pairing (multi-instance safe)
          if (redis) {
            const existingQueued = await readQueueMeta(me.userId);
            if (existingQueued) {
              gatewayLogInfo("Resumed existing ranked queue search", {
                ...queueLogContext,
                queuedForMs: Math.max(0, Date.now() - existingQueued.joinedAtMs),
                bucketKey: existingQueued.bucketKey,
              });
              await storeIdempotencyHit({
                redis,
                store: idempotencyStore,
                key: idempotency?.key,
                messageType: msg.type,
                value: { response: { type: "QUEUE_STATUS", payload: { status: "SEARCHING" } } },
              });
              send(ws, "QUEUE_STATUS", { status: "SEARCHING" });
              return;
            }

            state.clearQueueTimeout(me.userId);
            const queuedMeta = await queueJoin(me);
            gatewayLogDebug("Ranked queue join enqueued", {
              ...queueLogContext,
              bucketKey: queuedMeta?.bucketKey,
              rating: me.pvpRating,
            });

            const queuedMatch = await tryMatchQueuedUser(me);
            if (queuedMatch) {
              const other = await loadConnectionUser(queuedMatch.otherId);

              const otherWaitMs = queuedMatch.other ? Math.max(0, Date.now() - queuedMatch.other.joinedAtMs) : 0;
              await recordQueueMatchMetrics(redis, {
                queueWaitMs: [Math.max(0, Date.now() - queuedMatch.me.joinedAtMs), otherWaitMs],
                ratingDelta: Math.abs(other.pvpRating - me.pvpRating),
              });
              gatewayMetrics?.observeMatchStartLatency(
                "ranked",
                Math.max(Math.max(0, Date.now() - queuedMatch.me.joinedAtMs), otherWaitMs) / 1000
              );
              gatewayLogInfo("Ranked queue matched", {
                userIds: [other.userId, me.userId],
                ratingDelta: Math.abs(other.pvpRating - me.pvpRating),
                queueWaitMs: [Math.max(0, Date.now() - queuedMatch.me.joinedAtMs), otherWaitMs],
                preference: me.matchmakingPreference,
              });

              const created = await createRanked1v1Match({
                users: [
                  { ...other, slot: 0 },
                  { ...me, slot: 1 },
                ],
                persistUserIds: [other.userId, me.userId],
                startDelayMs: RANKED_MATCH_START_DELAY_MS,
              });
              await storeIdempotencyHit({
                redis,
                store: idempotencyStore,
                key: idempotency?.key,
                messageType: msg.type,
                value: { response: { type: "MATCH_FOUND", payload: created.payload } },
              });
              return;
            }

            await storeIdempotencyHit({
              redis,
              store: idempotencyStore,
              key: idempotency?.key,
              messageType: msg.type,
              value: { response: { type: "QUEUE_STATUS", payload: { status: "SEARCHING" } } },
            });

            // Fallback: after a timeout, start a match vs AI (and remove from Redis queue first).
            const timeout = setTimeout(() => {
              const userId = ws.user?.userId;
              if (!userId) return;

              // If there is no live socket, just clean up queue membership.
              const sockets = getAuthedSocketsForUser(wss, userId);
              if (sockets.length === 0) {
                gatewayLogInfo("Removed ranked queue user after disconnect before AI fallback", queueLogContext);
                void queueLeave(userId);
                state.clearQueueTimeout(userId);
                return;
              }

              void (async () => {
                const removed = await queueLeave(userId);
                if (removed === 0) {
                  gatewayLogDebug("Skipped ranked queue AI fallback because the user was no longer queued", queueLogContext);
                  return;
                }

                state.clearQueueTimeout(userId);
                const human = await loadConnectionUser(userId);
                const aiUserId = `ai:${crypto.randomUUID()}`;
                const created = await createRanked1v1Match({
                  users: [
                    { ...human, slot: 0 },
                    {
                      userId: aiUserId,
                      username: "Kai",
                      avatar: null,
                      pvpRating: human.pvpRating,
                      pvpDeviation: 180,
                      slot: 1,
                    },
                  ],
                  persistUserIds: [human.userId],
                  startDelayMs: RANKED_MATCH_START_DELAY_MS,
                });
                gatewayLogInfo("Created ranked AI fallback match", {
                  ...queueLogContext,
                  matchId: created.matchId,
                  queuedForMs: queuedMeta ? Math.max(0, Date.now() - queuedMeta.joinedAtMs) : undefined,
                });

                await startAiSimulationAdaptive({
                  prisma,
                  wss,
                  matchCache,
                  matchRepository,
                  matchId: created.matchId,
                  humanId: human.userId,
                  aiUserId,
                  snapshotIntervalMs: MATCH_SNAPSHOT_INTERVAL_MS,
                  state,
                  onFinalizeMatchIfComplete: (matchId) =>
                    finalizeMatchIfComplete({
                      prisma,
                      wss,
                      state,
                      eventBus,
                      matchId,
                    }),
                  onBroadcastMatchSnapshot: (matchId, nowMs, intervalMs) => {
                    const liveMatch = state.matches.get(matchId);
                    if (!liveMatch) return false;
                    return maybeBroadcastMatchSnapshot(wss, liveMatch, nowMs, intervalMs);
                  },
                });
              })().catch((e) => {
                const payload = toClientErrorPayload(e, {
                  code: PVP_ERROR_CODES.QUEUE_AI_FALLBACK_FAILED,
                  message: "AI fallback failed",
                  retryable: true,
                  details: { requestId, phase: "queue_ai_fallback" },
                });
                gatewayLogError("Ranked queue AI fallback failed", e, queueLogContext);
                sendToUser(wss, userId, "ERROR", payload);
                sendToUser(wss, userId, "QUEUE_STATUS", { status: "IDLE" });
              });
            }, AI_QUEUE_TIMEOUT_MS);

            state.queueTimeouts.set(me.userId, timeout);
            send(ws, "QUEUE_STATUS", { status: "SEARCHING" });
            return;
          }

          let localQueueResponseType: ServerMessage["type"] | null = null;
          let localQueueResponsePayload: unknown = null;
          let shouldSendLocalQueueResponse = false;

          await localQueueLock.runExclusive(async () => {
            const existingEntry = state.queue.find((entry) => entry.user.userId === ws.user!.userId);
            if (existingEntry) {
              gatewayLogInfo("Resumed existing local ranked queue search", {
                ...queueLogContext,
                queuedForMs: Math.max(0, Date.now() - existingEntry.joinedAtMs),
              });
              localQueueResponseType = "QUEUE_STATUS";
              localQueueResponsePayload = { status: "SEARCHING" };
              shouldSendLocalQueueResponse = true;
              return;
            }

            state.removeFromQueue(ws.user!.userId);
            state.clearQueueTimeout(ws.user!.userId);
            const queueResult = enqueueOrMatchInMemory({
              queue: state.queue,
              user: me,
              ratingRange: QUEUE_RATING_RANGE,
              requestId,
              connectionId: ws.connectionId,
            });

            if (queueResult.kind === "matched") {
              const [other, currentUser] = queueResult.users;
              state.clearQueueTimeout(currentUser.userId);
              state.clearQueueTimeout(other.userId);

              gatewayLogInfo("Ranked queue matched (local)", {
                userIds: [other.userId, currentUser.userId],
                ratingDelta: Math.abs(other.pvpRating - currentUser.pvpRating),
                queueWaitMs: queueResult.queueWaitMs,
                preference: currentUser.matchmakingPreference,
              });
              gatewayMetrics?.observeMatchStartLatency(
                "ranked",
                Math.max(...queueResult.queueWaitMs.map((value) => Math.max(0, value))) / 1000
              );

              const created = await createRanked1v1Match({
                users: [
                  { ...other, slot: 0 },
                  { ...currentUser, slot: 1 },
                ],
                persistUserIds: [other.userId, currentUser.userId],
                startDelayMs: RANKED_MATCH_START_DELAY_MS,
              });
              await storeIdempotencyHit({
                redis,
                store: idempotencyStore,
                key: idempotency?.key,
                messageType: msg.type,
                value: { response: { type: "MATCH_FOUND", payload: created.payload } },
              });
              localQueueResponseType = "MATCH_FOUND";
              localQueueResponsePayload = created.payload;
              return;
            }

            const timeout = setTimeout(() => {
              const userId = ws.user?.userId;
              if (!userId) return;
              const stillQueued = state.queue.find(
                (e) =>
                  e.user.userId === userId &&
                  e.requestId === requestId &&
                  e.connectionId === ws.connectionId
              );
              if (!stillQueued) return;

              const sockets = getAuthedSocketsForUser(wss, userId);
              if (sockets.length === 0) {
                state.removeFromQueue(userId);
                state.clearQueueTimeout(userId);
                return;
              }

              state.removeFromQueue(userId);
              state.clearQueueTimeout(userId);

              void (async () => {
                const human = stillQueued.user;
                const aiUserId = `ai:${crypto.randomUUID()}`;
                const created = await createRanked1v1Match({
                  users: [
                    {
                      userId: human.userId,
                      username: human.username,
                      avatar: human.avatar,
                      pvpRating: human.pvpRating,
                      pvpDeviation: human.pvpDeviation,
                      slot: 0,
                    },
                    {
                      userId: aiUserId,
                      username: "Kai",
                      avatar: null,
                      pvpRating: human.pvpRating,
                      pvpDeviation: 180,
                      slot: 1,
                    },
                  ],
                  persistUserIds: [human.userId],
                  startDelayMs: RANKED_MATCH_START_DELAY_MS,
                });
                gatewayLogInfo("Created local ranked AI fallback match", {
                  ...queueLogContext,
                  matchId: created.matchId,
                  queuedForMs: Math.max(0, Date.now() - stillQueued.joinedAtMs),
                });

                await startAiSimulationAdaptive({
                  prisma,
                  wss,
                  matchCache,
                  matchRepository,
                  matchId: created.matchId,
                  humanId: human.userId,
                  aiUserId,
                  snapshotIntervalMs: MATCH_SNAPSHOT_INTERVAL_MS,
                  state,
                  onFinalizeMatchIfComplete: (matchId) =>
                    finalizeMatchIfComplete({
                      prisma,
                      wss,
                      state,
                      eventBus,
                      matchId,
                    }),
                  onBroadcastMatchSnapshot: (matchId, nowMs, intervalMs) => {
                    const liveMatch = state.matches.get(matchId);
                    if (!liveMatch) return false;
                    return maybeBroadcastMatchSnapshot(wss, liveMatch, nowMs, intervalMs);
                  },
                });
              })().catch((e) => {
                const payload = toClientErrorPayload(e, {
                  code: PVP_ERROR_CODES.QUEUE_AI_FALLBACK_FAILED,
                  message: "AI fallback failed",
                  retryable: true,
                  details: { requestId, phase: "queue_ai_fallback" },
                });
                gatewayLogError("Local ranked queue AI fallback failed", e, queueLogContext);
                sendToUser(wss, userId, "ERROR", payload);
                sendToUser(wss, userId, "QUEUE_STATUS", { status: "IDLE" });
              });
            }, AI_QUEUE_TIMEOUT_MS);
            state.queueTimeouts.set(ws.user!.userId, timeout);
            localQueueResponseType = "QUEUE_STATUS";
            localQueueResponsePayload = { status: "SEARCHING" };
            shouldSendLocalQueueResponse = true;
          });

          if (localQueueResponseType) {
            await storeIdempotencyHit({
              redis,
              store: idempotencyStore,
              key: idempotency?.key,
              messageType: msg.type,
              value: {
                response: {
                  type: localQueueResponseType,
                  payload: localQueueResponsePayload,
                },
              },
            });
          }
          if (localQueueResponseType && shouldSendLocalQueueResponse) {
            send(ws, localQueueResponseType, localQueueResponsePayload);
          }
          return;
        }

        if (msg.type === "QUEUE_LEAVE") {
          state.removeFromQueue(ws.user.userId);
          state.clearQueueTimeout(ws.user.userId);
          await queueLeave(ws.user.userId);
          await storeIdempotencyHit({
            redis,
            store: idempotencyStore,
            key: idempotency?.key,
            messageType: msg.type,
            value: { response: { type: "QUEUE_STATUS", payload: { status: "IDLE" } } },
          });
          send(ws, "QUEUE_STATUS", { status: "IDLE" });
          return;
        }

        if (msg.type === "MATCH_JOIN") {
          const lastSeenRevision = Math.max(0, msg.payload.lastSeenRevision ?? 0);
          const fullUser = await loadConnectionUser(ws.user.userId);
          ws.user = {
            ...fullUser,
            tokenVersion: ws.user.tokenVersion,
            validAfter: ws.user.validAfter,
            issuedAt: ws.user.issuedAt,
          };
          gatewayLogDebug("Match join requested", {
            userId: ws.user.userId,
            matchId: msg.payload.matchId,
          });

          // Cancel the disconnect-forfeit timer BEFORE the async DB lookup.
          // Without this, the timer can fire during the ~200-300ms await window and
          // finalise the match before clearDisconnectForfeitTimer is ever reached
          // below, causing a spurious "match_closed" rejection on a legitimate rejoin.
          clearDisconnectForfeitTimer(msg.payload.matchId, ws.user.userId);

          await matchJoinLock.runExclusive(async () => {
            const sessionKey = `${msg.payload.matchId}:${ws.user!.userId}`;
            const cachedMatch = state.matches.get(msg.payload.matchId);

            if (
              ws.matchId === msg.payload.matchId &&
              ws.matchSessionKey === sessionKey &&
              cachedMatch?.participants.has(ws.user!.userId)
            ) {
              const cachedPayload = buildMatchStatePayload(cachedMatch);
              await storeIdempotencyHit({
                redis,
                store: idempotencyStore,
                key: idempotency?.key,
                messageType: msg.type,
                value: {
                  response: {
                    type: "MATCH_STATE",
                    payload: cachedPayload,
                  },
                },
              });
              send(ws, "MATCH_STATE", cachedPayload);
              return;
            }

            const joinSnapshot = await matchRepository.withTransaction(async (tx) => {
              const dbMatch = await matchRepository.loadForUpdate(tx, msg.payload.matchId);

              const participantRow = await tx.pvpParticipant.findUnique({
                where: {
                  matchId_userId: {
                    matchId: msg.payload.matchId,
                    userId: ws.user!.userId,
                  },
                },
                select: {
                  slot: true,
                  user: {
                    select: {
                      username: true,
                      profile: { select: { avatar: true } },
                    },
                  },
                },
              });

              const matchJoinAccess = canJoinPvpMatchSocket({
                status: dbMatch?.status ?? "FINISHED",
                participantExists: Boolean(participantRow),
                userId: ws.user!.userId,
              });

              if (!matchJoinAccess.allowed) {
                return {
                  ok: false as const,
                  error:
                    matchJoinAccess.reason === "not_participant"
                      ? "Not a participant"
                      : "Match can no longer be joined",
                };
              }

              if (!dbMatch) {
                return { ok: false as const, error: "Match not found" };
              }

              const participants = await tx.pvpParticipant.findMany({
                where: { matchId: dbMatch.id },
                select: {
                  userId: true,
                  slot: true,
                  user: {
                    select: {
                      username: true,
                      profile: { select: { avatar: true } },
                    },
                  },
                },
              });

              const liveState: MatchLiveState =
                dbMatch.liveState ??
                createInitialLiveState({
                  state: matchStateFromDbStatus(dbMatch.status),
                  participants: participants.map((participant) => ({
                    userId: participant.userId,
                    username: sanitizeDisplayName(participant.user.username ?? "user", 32) || "user",
                    avatar: sanitizeAvatarUrl(participant.user.profile?.avatar ?? null),
                    slot: participant.slot,
                  })),
                });

              const participantState = liveState.participants[ws.user!.userId];
              if (participantState) {
                participantState.lastInputAtMs = Date.now();
              }

              if (liveState.reconnectUntilByUserId) {
                delete liveState.reconnectUntilByUserId[ws.user!.userId];
              }

              const staleGap = Math.max(0, dbMatch.revision - lastSeenRevision);
              const shouldReplayProgressDeltas = staleGap > 0 && staleGap <= MATCH_RESUME_DELTA_LIMIT;
              const progressDeltas = shouldReplayProgressDeltas
                ? (liveState.deltas ?? [])
                    .filter((delta) => delta.type === "PROGRESS" && delta.revision > lastSeenRevision)
                    .slice(-MATCH_RESUME_DELTA_LIMIT)
                    .map((delta) => delta.payload)
                : [];

              const updateResult = await matchRepository.updateWithRevision(tx, dbMatch.id, {
                expectedRevision: dbMatch.revision,
                nextState: liveState.state,
                liveState,
                instanceId: INSTANCE_ID,
                serverStartAt: dbMatch.serverStartAt,
                startedAt: dbMatch.startedAt,
                endedAt: dbMatch.endedAt,
              });

              return {
                ok: true as const,
                dbMatch,
                participants,
                participantRow,
                liveState,
                revision: updateResult.applied ? updateResult.nextRevision : dbMatch.revision,
                progressDeltas,
              };
            });

            if (!joinSnapshot.ok) {
              gatewayLogWarn("Blocked invalid match join", {
                userId: ws.user!.userId,
                matchId: msg.payload.matchId,
                reason: joinSnapshot.error,
              });
              send(ws, "ERROR", { message: joinSnapshot.error });
              return;
            }

            const participantRow = joinSnapshot.participantRow;
            const db = joinSnapshot.dbMatch;
            const match = state.matches.get(msg.payload.matchId);
            if (!match) {
              const lifecycleState = matchStateFromDbStatus(db.status);
              state.matches.set(db.id, {
                matchId: db.id,
                roomCode: null,
                state: lifecycleState,
                stateChangedAt: joinSnapshot.liveState.stateChangedAtMs,
                revision: joinSnapshot.revision,
                lastSnapshotBroadcastAtMs: 0,
                status: matchStateToLegacyStatus(lifecycleState),
                textSnapshot: db.textSnapshot,
                textId: db.textId ?? null,
                inputNonce: db.inputNonce ?? null,
                serverStartAtMs: db.serverStartAt ? db.serverStartAt.getTime() : Date.now() + 3000,
                participants: new Map(),
                endedReason: joinSnapshot.liveState.endedReason,
                forfeitedUserId: joinSnapshot.liveState.forfeitedUserId,
                rematchMatchId: joinSnapshot.liveState.rematchMatchId,
                finalizedAtMs: joinSnapshot.liveState.finalizedAtMs,
                cleanupScheduledAtMs: null,
                reconnectUntilByUserId: joinSnapshot.liveState.reconnectUntilByUserId ?? {},
                recentDeltas: joinSnapshot.liveState.deltas ?? [],
              });

              const hydrated = state.matches.get(db.id);
              if (hydrated) {
                for (const participant of joinSnapshot.participants) {
                  hydrated.participants.set(participant.userId, {
                    userId: participant.userId,
                    username: sanitizeDisplayName(participant.user.username ?? "user", 32) || "user",
                    avatar: sanitizeAvatarUrl(participant.user.profile?.avatar ?? null),
                    slot: participant.slot,
                    input: joinSnapshot.liveState.participants[participant.userId]?.input ?? "",
                    seq: joinSnapshot.liveState.participants[participant.userId]?.seq ?? 0,
                    errors: joinSnapshot.liveState.participants[participant.userId]?.errors ?? 0,
                    wpm: joinSnapshot.liveState.participants[participant.userId]?.wpm ?? 0,
                    accuracy: joinSnapshot.liveState.participants[participant.userId]?.accuracy ?? 100,
                    finishedAt: joinSnapshot.liveState.participants[participant.userId]?.finishedAt ?? null,
                    lastInputAtMs: joinSnapshot.liveState.participants[participant.userId]?.lastInputAtMs ?? undefined,
                    inputEvents: joinSnapshot.liveState.participants[participant.userId]?.inputEvents ?? [],
                  });

                  participantMetricAccumulators.set(
                    getParticipantMetricKey(db.id, participant.userId),
                    {
                      correctChars: joinSnapshot.liveState.participants[participant.userId]?.correctChars ?? 0,
                      mismatchChars: joinSnapshot.liveState.participants[participant.userId]?.mismatchChars ?? 0,
                    }
                  );
                }
              }

              await registerReplayNonce(redis, db.id, db.inputNonce ?? null);
            }

            const effective = state.matches.get(msg.payload.matchId)!;
            effective.revision = Math.max(effective.revision, joinSnapshot.revision);
            effective.reconnectUntilByUserId = joinSnapshot.liveState.reconnectUntilByUserId ?? effective.reconnectUntilByUserId ?? {};
            effective.recentDeltas = joinSnapshot.liveState.deltas ?? effective.recentDeltas ?? [];
            const effectiveAccess = canJoinPvpMatchSocket({
              status: effective.status,
              participantExists: Boolean(participantRow),
              userId: ws.user!.userId,
              forfeitedUserId: effective.forfeitedUserId,
              endedReason: effective.endedReason,
            });
            if (!effectiveAccess.allowed) {
              send(ws, "ERROR", {
                message: effectiveAccess.reason === "disconnect_forfeit" ? "Reconnect is not allowed after disconnect forfeit" : "Match can no longer be joined",
              });
              return;
            }
            const p = effective.participants.get(ws.user!.userId);
            if (!p) {
              if (!participantRow) {
                send(ws, "ERROR", { message: "Not a participant" });
                return;
              }

              effective.participants.set(ws.user!.userId, {
                userId: ws.user!.userId,
                username: ws.user!.username,
                avatar: ws.user!.avatar,
                slot: participantRow.slot,
                input: "",
                seq: 0,
                errors: 0,
                wpm: 0,
                accuracy: 100,
                finishedAt: null,
              });
            }

            ws.matchId = msg.payload.matchId;
            claimMatchSession(msg.payload.matchId, ws.user!.userId, ws);

            if (effective.roomCode === null && effective.state === "waiting_for_both") {
              await maybeStartRankedCountdown(effective);
            }

            const matchStatePayload = buildMatchStatePayload(effective);
            const localResumeDeltas = (effective.recentDeltas ?? [])
              .filter((delta) => delta.type === "PROGRESS" && delta.revision > lastSeenRevision)
              .slice(-MATCH_RESUME_DELTA_LIMIT)
              .map((delta) => delta.payload);

            const replayProgressDeltas = localResumeDeltas.length > 0 ? localResumeDeltas : joinSnapshot.progressDeltas;
            await storeIdempotencyHit({
              redis,
              store: idempotencyStore,
              key: idempotency?.key,
              messageType: msg.type,
              value: {
                response: {
                  type: "MATCH_STATE",
                  payload: matchStatePayload,
                },
              },
            });
            send(ws, "MATCH_STATE", matchStatePayload);

            if (replayProgressDeltas.length > 0) {
              for (const deltaPayload of replayProgressDeltas) {
                send(ws, "PROGRESS", deltaPayload);
              }
            }
          });

          return;
        }

        if (msg.type === "MATCH_LEAVE") {
          const match = state.matches.get(msg.payload.matchId);
          if (!match) {
            send(ws, "ERROR", { message: "Unknown match" });
            return;
          }

          if (!match.participants.has(ws.user.userId)) {
            send(ws, "ERROR", { message: "Not a participant" });
            return;
          }

          clearDisconnectForfeitTimer(match.matchId, ws.user.userId);
          releaseMatchSession(ws);
          ws.matchId = undefined;

          if (match.participants.size === 2 && !isTerminalPvpMatchStatus(match.status)) {
            if (match.state === "live") {
              await finalizeMatchByDisconnectForfeit({
                prisma,
                wss,
                state,
                eventBus,
                matchId: match.matchId,
                forfeitedUserId: ws.user.userId,
              });
            } else {
              await abortMatchLifecycle({
                prisma,
                wss,
                state,
                eventBus,
                matchId: match.matchId,
                reasonCode: "no_show",
                reasonMessage: "The match was cancelled because a player left before it started.",
              });
            }
          }

          return;
        }

        if (msg.type === "INPUT_UPDATE") {
          const match = state.matches.get(msg.payload.matchId);
          if (!match) {
            send(ws, "ERROR", { message: "Unknown match" });
            return;
          }

          const participant = match.participants.get(ws.user.userId);
          if (!participant) {
            send(ws, "ERROR", { message: "Not joined" });
            return;
          }

          if (match.state === "waiting_for_both") {
            send(ws, "ERROR", { message: "Waiting for both players to connect" });
            return;
          }

          // Authoritative timing
          const nowMs = Date.now();
          if (nowMs < match.serverStartAtMs) {
            send(ws, "ERROR", { message: "Match not started" });
            return;
          }

          if (match.state === "countdown") {
            applyMatchTransition({ match, nextState: "live", eventBus, reason: "completed" });
          }

          const inputDecision = shouldAcceptInputUpdate({
            lastProcessedSeq: participant.seq,
            incomingSeq: msg.payload.seq,
            cachedProcessedSeq: idempotency?.record?.processedSeq,
          });
          if (!inputDecision.accept) return;

          const replayDecision = await validateReplayProtectedInput({
            redis,
            matchId: match.matchId,
            userId: ws.user.userId,
            seq: msg.payload.seq,
            inputNonce: msg.payload.inputNonce,
            expectedNonce: match.inputNonce,
          });
          if (!replayDecision.accept) {
            incrementGatewayMetric("pvp_anti_cheat_nonce_reject_total", {
              reason:
                replayDecision.reason === "missing_nonce"
                  ? "missing"
                  : replayDecision.reason === "mismatch_nonce"
                    ? "mismatch"
                    : "replayed_seq",
            });
            send(ws, "ERROR", {
              message:
                replayDecision.reason === "replayed_seq"
                  ? "This PvP input was already processed. Please refresh and try again."
                  : "This PvP client is out of date. Please refresh and try again.",
            });
            return;
          }

          // Anti-cheat: input must evolve by append or backspace only.
          const prev = participant.input;
          const next = msg.payload.input;
          if (next.length > match.textSnapshot.length) {
            incrementGatewayMetric("ws_validation_failed", { reason: "input_exceeds_text" });
            send(ws, "ERROR", { message: "Input exceeds match text length" });
            return;
          }

          const isAppend = next.startsWith(prev);
          const isBackspace = prev.startsWith(next);
          if (!isAppend && !isBackspace) {
            incrementGatewayMetric("ws_validation_failed", { reason: "invalid_input_evolution" });
            send(ws, "ERROR", { message: "Invalid input evolution" });
            return;
          }

          if (isAppend) {
            const added = next.slice(prev.length);
            if (added.length > 32) {
              incrementGatewayMetric("ws_validation_failed", { reason: "input_delta_too_large" });
              send(ws, "ERROR", { message: "Input delta too large" });
              return;
            }

            // Verify appended chars against text snapshot to prevent skipping.
            for (let i = 0; i < added.length; i += 1) {
              const pos = prev.length + i;
              if (pos >= match.textSnapshot.length) break;
              // We allow wrong chars (typing errors), but disallow jumping positions.
              void match.textSnapshot[pos];
            }
          }

          const nextInput = next.slice(0, match.textSnapshot.length);
          updateParticipantMetricsIncremental({
            matchId: match.matchId,
            textSnapshot: match.textSnapshot,
            participant,
            nextInput,
            nowMs,
            startedAtMs: match.serverStartAtMs,
          });

          participant.seq = msg.payload.seq;
          participant.inputEvents = participant.inputEvents ?? [];
          participant.inputEvents.push({
            atMs: nowMs,
            inputLength: participant.input.length,
            deltaChars: participant.input.length - (participant.lastInputLen ?? 0),
            wpm: participant.wpm,
          });
          if (participant.inputEvents.length > 64) {
            participant.inputEvents.shift();
          }
          participant.lastInputAtMs = nowMs;
          participant.lastInputLen = participant.input.length;
          observeGatewayHistogram("pvp_input_update_chars", participant.input.length, [8, 16, 32, 64, 128, 256, 512, 1024]);

          enqueueInputUpdateBatch(match.matchId, ws.user.userId, msg.payload.seq);
          const queuedBatch = pendingInputUpdatesByMatch.get(match.matchId);
          if (queuedBatch && queuedBatch.enqueuedCount >= INPUT_UPDATE_FLUSH_MAX_ENQUEUED) {
            void flushPendingInputUpdates("threshold");
          }

          await registerAcceptedReplaySeq(redis, match.matchId, ws.user.userId, msg.payload.seq);

          if (participant.input.length >= match.textSnapshot.length && participant.finishedAt === null) {
            participant.finishedAt = nowMs;
          }

          // Broadcast progress
          const progressPayload = buildProgressPayload(match, participant, nowMs);
          appendMatchDelta(match, {
            type: "PROGRESS",
            payload: progressPayload,
            atMs: nowMs,
          });
          broadcastMatch(wss, match.matchId, "PROGRESS", progressPayload);
          maybeBroadcastMatchSnapshot(wss, match, nowMs, MATCH_SNAPSHOT_INTERVAL_MS);

          await storeIdempotencyHit({
            redis,
            store: idempotencyStore,
            key: idempotency?.key,
            messageType: msg.type,
            value: { processedSeq: msg.payload.seq },
          });

          await finalizeMatchIfComplete({ prisma, wss, state, eventBus, matchId: match.matchId });

          return;
        }

        if (msg.type === "FINISH") {
          const match = state.matches.get(msg.payload.matchId);
          if (!match) {
            send(ws, "ERROR", { message: "Unknown match" });
            return;
          }

          const participant = match.participants.get(ws.user.userId);
          if (!participant) {
            send(ws, "ERROR", { message: "Not joined" });
            return;
          }

          if (participant.finishedAt == null) {
            participant.finishedAt = Date.now();
          }

          // Persist participant final stats best-effort
          await prisma.pvpParticipant.update({
            where: {
              matchId_userId: {
                matchId: match.matchId,
                userId: participant.userId,
              },
            },
            data: {
              finalWpm: participant.wpm,
              finalAccuracy: participant.accuracy,
              finalErrors: participant.errors,
              timeSpentSec: Math.max(0, Math.floor((participant.finishedAt - match.serverStartAtMs) / 1000)),
              completedAt: new Date(participant.finishedAt),
            },
          });

          await storeIdempotencyHit({
            redis,
            store: idempotencyStore,
            key: idempotency?.key,
            messageType: msg.type,
            value: { processedSeq: participant.seq },
          });

          await finalizeMatchIfComplete({ prisma, wss, state, eventBus, matchId: match.matchId });

          return;
        }

        if (msg.type === "REMATCH_REQUEST") {
          const match = state.matches.get(msg.payload.matchId);
          if (!match) {
            send(ws, "ERROR", { message: "Unknown match" });
            return;
          }
          if (match.rematchMatchId) {
            resendExistingRematch(match.rematchMatchId, ws.user.userId);
            return;
          }
          if (match.status !== "FINISHED") {
            send(ws, "ERROR", { message: "Match not finished" });
            return;
          }
          if (match.roomCode !== null) {
            send(ws, "ERROR", { message: "Rematch not supported for rooms" });
            return;
          }

          const participants = Array.from(match.participants.values());
          if (participants.length !== 2) {
            send(ws, "ERROR", { message: "Rematch only supported for 1v1" });
            return;
          }

          const meId = ws.user.userId;
          const me = match.participants.get(meId);
          if (!me) {
            send(ws, "ERROR", { message: "Not a participant" });
            return;
          }

          const other = participants.find((p) => p.userId !== meId)!;

          // AI rematch: probabilistic accept/reject with cooldown to prevent farming.
          if (isAiUserId(other.userId)) {
            const now = Date.now();
            const refuseUntil = aiRematchRefuseUntilByHumanId.get(meId) ?? 0;
            if (now < refuseUntil) {
              sendToUser(wss, meId, "REMATCH_DECLINED", {
                matchId: msg.payload.matchId,
                byUserId: other.userId,
                reason: "AI_COOLDOWN",
              });
              return;
            }

            const flip = Math.floor(Math.random() * 2); // 0 => accept, 1 => reject
            if (flip === 1) {
              aiRematchRefuseUntilByHumanId.set(meId, now + AI_REMATCH_COOLDOWN_MS);
              sendToUser(wss, meId, "REMATCH_DECLINED", {
                matchId: msg.payload.matchId,
                byUserId: other.userId,
                reason: "AI_REFUSED",
              });
              return;
            }

            aiRematchRefuseUntilByHumanId.set(meId, now + AI_REMATCH_COOLDOWN_MS);

            // Start a new AI match immediately.
            const matchRow = await prisma.pvpMatch.create({
              data: { status: "PENDING", textSnapshot: "placeholder" },
              select: { id: true },
            });

            const rankedText = await selectRankedText({
              matchId: matchRow.id,
              userIds: [meId],
              redis,
            });
            const inputNonce = createInputNonce();

            const serverStartAtMs = Date.now() + RANKED_MATCH_START_DELAY_MS;
            const aiUserId = `ai:${matchRow.id}`;

            const local = state.createLocalMatch({
              matchId: matchRow.id,
              roomCode: null,
              users: [
                {
                  userId: ws.user.userId,
                  username: ws.user.username,
                  avatar: ws.user.avatar,
                  pvpRating: ws.user.pvpRating,
                  pvpDeviation: ws.user.pvpDeviation,
                  slot: me.slot,
                },
                {
                  userId: aiUserId,
                  username: other.username,
                  avatar: null,
                  pvpRating: ws.user.pvpRating,
                  pvpDeviation: 180,
                  slot: other.slot,
                },
              ],
              serverStartAtMs,
              textSnapshot: rankedText.textSnapshot,
              textId: rankedText.textId,
              inputNonce,
            });

            await registerReplayNonce(redis, matchRow.id, local.inputNonce);

            await prisma.pvpMatch.update({
              where: { id: matchRow.id },
              data: {
                status: "COUNTDOWN",
                textSnapshot: local.textSnapshot,
                textId: local.textId,
                inputNonce: local.inputNonce,
                serverStartAt: new Date(serverStartAtMs),
              },
            });

            await prisma.pvpParticipant.createMany({
              data: [{ matchId: matchRow.id, userId: ws.user.userId, slot: me.slot }],
              skipDuplicates: true,
            });

            sendToUser(wss, meId, "MATCH_FOUND", {
              matchId: matchRow.id,
              textSnapshot: local.textSnapshot,
              textId: local.textId,
              inputNonce: local.inputNonce,
              serverStartAt: new Date(serverStartAtMs).toISOString(),
              players: Array.from(local.participants.values()).map((p) => ({
                userId: p.userId,
                username: p.username,
                avatar: p.avatar,
                slot: p.slot,
              })),
            });

            await startAiSimulationAdaptive({
              prisma,
              wss,
              matchCache,
              matchRepository,
              matchId: matchRow.id,
              humanId: meId,
              aiUserId,
              snapshotIntervalMs: MATCH_SNAPSHOT_INTERVAL_MS,
              state,
              onFinalizeMatchIfComplete: (matchId) =>
                finalizeMatchIfComplete({
                  prisma,
                  wss,
                  state,
                  eventBus,
                  matchId,
                }),
              onBroadcastMatchSnapshot: (matchId, nowMs, intervalMs) => {
                const liveMatch = state.matches.get(matchId);
                if (!liveMatch) return false;
                return maybeBroadcastMatchSnapshot(wss, liveMatch, nowMs, intervalMs);
              },
            });

            return;
          }

          // Human vs human: require both to accept.
          let accepted = rematchAcceptedByMatchId.get(match.matchId);
          if (!accepted) {
            accepted = new Set<string>();
            rematchAcceptedByMatchId.set(match.matchId, accepted);
          }

          accepted.add(meId);

          const acceptedUserIds = Array.from(accepted);
          sendToUser(wss, meId, "REMATCH_STATUS", { matchId: match.matchId, acceptedUserIds });
          sendToUser(wss, other.userId, "REMATCH_OFFER", { matchId: match.matchId, fromUserId: meId });
          sendToUser(wss, other.userId, "REMATCH_STATUS", { matchId: match.matchId, acceptedUserIds });

          if (accepted.size >= 2) {
            rematchAcceptedByMatchId.delete(match.matchId);

            const [aConn, bConn] = await Promise.all([
              loadConnectionUser(meId),
              loadConnectionUser(other.userId),
            ]);

            await createLockedHumanRematch({
              sourceMatchId: match.matchId,
              users: [
                { ...aConn, slot: me.slot },
                { ...bConn, slot: other.slot },
              ],
              persistUserIds: [meId, other.userId],
            });
          }

          return;
        }

        if (msg.type === "REMATCH_RESPONSE") {
          const match = state.matches.get(msg.payload.matchId);
          if (!match) {
            send(ws, "ERROR", { message: "Unknown match" });
            return;
          }
          if (match.rematchMatchId) {
            resendExistingRematch(match.rematchMatchId, ws.user.userId);
            return;
          }
          if (match.status !== "FINISHED") {
            send(ws, "ERROR", { message: "Match not finished" });
            return;
          }
          if (match.roomCode !== null) {
            send(ws, "ERROR", { message: "Rematch not supported for rooms" });
            return;
          }

          const participants = Array.from(match.participants.values());
          if (participants.length !== 2) {
            send(ws, "ERROR", { message: "Rematch only supported for 1v1" });
            return;
          }

          const meId = ws.user.userId;
          const me = match.participants.get(meId);
          if (!me) {
            send(ws, "ERROR", { message: "Not a participant" });
            return;
          }

          const other = participants.find((p) => p.userId !== meId)!;

          if (!msg.payload.accept) {
            rematchAcceptedByMatchId.delete(match.matchId);
            sendToUser(wss, other.userId, "REMATCH_DECLINED", {
              matchId: match.matchId,
              byUserId: meId,
              reason: "DECLINED",
            });
            sendToUser(wss, meId, "REMATCH_DECLINED", {
              matchId: match.matchId,
              byUserId: meId,
              reason: "DECLINED",
            });
            return;
          }

          let accepted = rematchAcceptedByMatchId.get(match.matchId);
          if (!accepted) {
            accepted = new Set<string>();
            rematchAcceptedByMatchId.set(match.matchId, accepted);
          }

          accepted.add(meId);
          const acceptedUserIds = Array.from(accepted);
          sendToUser(wss, meId, "REMATCH_STATUS", { matchId: match.matchId, acceptedUserIds });
          sendToUser(wss, other.userId, "REMATCH_STATUS", { matchId: match.matchId, acceptedUserIds });

          if (accepted.size >= 2) {
            rematchAcceptedByMatchId.delete(match.matchId);

            const [aConn, bConn] = await Promise.all([
              loadConnectionUser(meId),
              loadConnectionUser(other.userId),
            ]);

            await createLockedHumanRematch({
              sourceMatchId: match.matchId,
              users: [
                { ...aConn, slot: me.slot },
                { ...bConn, slot: other.slot },
              ],
              persistUserIds: [meId, other.userId],
            });
          } else {
            sendToUser(wss, other.userId, "REMATCH_OFFER", { matchId: match.matchId, fromUserId: meId });
          }

          return;
        }

        if (msg.type === "ROOM_JOIN") {
          const roomActionKey = `${ws.user.userId}:room_join`;
          const now = Date.now();
          const lastRoomAction = roomActionLastSeen.get(roomActionKey) ?? 0;
          if (now - lastRoomAction < ROOM_ACTION_COOLDOWN_MS) {
            incrementGatewayMetric("ws_rate_limit_rejected", { reason: "room_join_cooldown" });
            send(ws, "ERROR", { message: "Room join cooldown active" });
            return;
          }
          roomActionLastSeen.set(roomActionKey, now);

          const code = sanitizeRoomCode(msg.payload.code);
          if (code.length < 4) {
            incrementGatewayMetric("ws_validation_failed", { reason: "room_code_invalid" });
            send(ws, "ERROR", { message: "Invalid room code" });
            return;
          }
          ws.roomCode = code;

          const room = await prisma.pvpRoom.findUnique({
            where: { code },
            select: {
              id: true,
              code: true,
              status: true,
              visibility: true,
              minPlayers: true,
              maxPlayers: true,
              autoStartAt: true,
              expiresAt: true,
              hostUserId: true,
            },
          });
          if (!room) {
            send(ws, "ERROR", { message: "Room not found" });
            return;
          }
          if (room.expiresAt && room.expiresAt.getTime() < Date.now()) {
            send(ws, "ERROR", { message: "Room expired" });
            return;
          }
          if (room.status !== "OPEN") {
            send(ws, "ERROR", { message: "Room not open" });
            return;
          }

          // Determine color slot
          const members = await prisma.pvpRoomMember.findMany({
            where: { roomId: room.id, leftAt: null },
            select: { userId: true, colorSlot: true, readyAt: true, user: { select: { username: true, profile: { select: { avatar: true } } } } },
          });

          const existingMember = members.find((member) => member.userId === ws.user!.userId) ?? null;

          if (members.length >= room.maxPlayers && !existingMember) {
            send(ws, "ERROR", { message: "Room full" });
            return;
          }

          const used = new Set(members.map((m) => m.colorSlot));
          let slot = existingMember?.colorSlot ?? 0;
          if (!existingMember) {
            while (used.has(slot) && slot < room.maxPlayers) slot += 1;
            if (slot >= room.maxPlayers) slot = Math.min(room.maxPlayers - 1, 5);
          }

          const reconnectKey = buildRoomReconnectKey(room.id, ws.user.userId);
          const restoringMembership = redis ? (await redis.exists(reconnectKey)) === 1 : false;

          await prisma.pvpRoomMember.upsert({
            where: { roomId_userId: { roomId: room.id, userId: ws.user.userId } },
            update: restoringMembership ? { leftAt: null } : { leftAt: null, readyAt: null },
            create: { roomId: room.id, userId: ws.user.userId, colorSlot: slot },
          });

          if (redis && restoringMembership) {
            await redis.del(reconnectKey);
          }

          await touchRoomExpiry(prisma, room.id);

          if (!room.hostUserId) {
            await prisma.pvpRoom.update({
              where: { id: room.id },
              data: { hostUserId: ws.user.userId },
            });
          }

          await broadcastRoomState(prisma, wss, code);
          if (room.visibility === "PUBLIC") {
            await maybeAutoStartPublicRoom(code);
          }

          await storeIdempotencyHit({
            redis,
            store: idempotencyStore,
            key: idempotency?.key,
            messageType: msg.type,
            value: { response: null },
          });

          return;
        }

        if (msg.type === "READY") {
          const roomActionKey = `${ws.user.userId}:ready`;
          const now = Date.now();
          const lastRoomAction = roomActionLastSeen.get(roomActionKey) ?? 0;
          if (now - lastRoomAction < ROOM_ACTION_COOLDOWN_MS) {
            incrementGatewayMetric("ws_rate_limit_rejected", { reason: "ready_cooldown" });
            send(ws, "ERROR", { message: "Ready cooldown active" });
            return;
          }
          roomActionLastSeen.set(roomActionKey, now);

          const code = sanitizeRoomCode(msg.payload?.roomCode ?? ws.roomCode ?? "");
          if (!code) {
            send(ws, "ERROR", { message: "No room" });
            return;
          }

          const room = await prisma.pvpRoom.findUnique({
            where: { code },
            select: { id: true, code: true, status: true, visibility: true, maxPlayers: true },
          });
          if (!room) {
            send(ws, "ERROR", { message: "Room not found" });
            return;
          }
          if (room.status !== "OPEN") {
            send(ws, "ERROR", { message: "Room not open" });
            return;
          }

          await prisma.pvpRoomMember.update({
            where: { roomId_userId: { roomId: room.id, userId: ws.user.userId } },
            data: { readyAt: new Date() },
          });

          await touchRoomExpiry(prisma, room.id);
          await broadcastRoomState(prisma, wss, code);
          if (room.visibility === "PUBLIC") {
            await maybeAutoStartPublicRoom(code);
          }

          await storeIdempotencyHit({
            redis,
            store: idempotencyStore,
            key: idempotency?.key,
            messageType: msg.type,
            value: { response: null },
          });

          return;
        }

        if (msg.type === "ROOM_START") {
          const code = sanitizeRoomCode(msg.payload.roomCode ?? ws.roomCode ?? "");
          if (!code) {
            send(ws, "ERROR", { message: "No room" });
            return;
          }

          const room = await prisma.pvpRoom.findUnique({
            where: { code },
            select: { id: true, code: true, status: true, visibility: true, hostUserId: true },
          });
          if (!room) {
            send(ws, "ERROR", { message: "Room not found" });
            return;
          }
          if (room.status !== "OPEN") {
            send(ws, "ERROR", { message: "Room not open" });
            return;
          }
          if (room.visibility !== "PRIVATE") {
            send(ws, "ERROR", { message: "Public rooms start automatically" });
            return;
          }
          if (room.hostUserId !== ws.user.userId) {
            send(ws, "ERROR", { message: "Host only action" });
            return;
          }

          const members = await prisma.pvpRoomMember.findMany({
            where: { roomId: room.id, leftAt: null },
            orderBy: { joinedAt: "asc" },
            select: {
              userId: true,
              colorSlot: true,
              readyAt: true,
              leftAt: true,
              user: { select: { username: true, profile: { select: { avatar: true } } } },
            },
          });

          if (!isRoomReadyToStart({ members })) {
            send(ws, "ERROR", { message: "All players must be ready before the host can start" });
            return;
          }

          await startRoomMatch({
            roomId: room.id,
            roomCode: code,
            members,
          });

          await storeIdempotencyHit({
            redis,
            store: idempotencyStore,
            key: idempotency?.key,
            messageType: msg.type,
            value: { response: null },
          });

          return;
        }

        if (msg.type === "ROOM_KICK") {
          const code = sanitizeRoomCode(msg.payload.roomCode ?? ws.roomCode ?? "");
          if (!code) {
            send(ws, "ERROR", { message: "No room" });
            return;
          }

          const room = await prisma.pvpRoom.findUnique({
            where: { code },
            select: { id: true, code: true, status: true, visibility: true, hostUserId: true },
          });
          if (!room) {
            send(ws, "ERROR", { message: "Room not found" });
            return;
          }
          if (room.visibility !== "PRIVATE") {
            send(ws, "ERROR", { message: "Public rooms do not support host kicks" });
            return;
          }
          if (room.hostUserId !== ws.user.userId) {
            send(ws, "ERROR", { message: "Host only action" });
            return;
          }
          if (msg.payload.userId === ws.user.userId) {
            send(ws, "ERROR", { message: "Host cannot kick itself" });
            return;
          }

          await prisma.pvpRoomMember.update({
            where: { roomId_userId: { roomId: room.id, userId: msg.payload.userId } },
            data: { leftAt: new Date(), readyAt: null },
          }).catch(() => null);

          if (redis) {
            await redis.del(buildRoomReconnectKey(room.id, msg.payload.userId));
          }

          sendToUser(wss, msg.payload.userId, "ERROR", { message: "Kicked from room" });
          await transferRoomHostIfNeeded(prisma, room.id);
          await touchRoomExpiry(prisma, room.id);
          await broadcastRoomState(prisma, wss, code);

          await storeIdempotencyHit({
            redis,
            store: idempotencyStore,
            key: idempotency?.key,
            messageType: msg.type,
            value: { response: null },
          });

          return;
        }

        if (msg.type === "ROOM_LEAVE") {
          const code = sanitizeRoomCode(msg.payload?.roomCode ?? ws.roomCode ?? "");
          if (!code) {
            send(ws, "ERROR", { message: "No room" });
            return;
          }

          const room = await prisma.pvpRoom.findUnique({
            where: { code },
            select: { id: true, code: true, status: true, visibility: true },
          });
          if (!room) {
            send(ws, "ERROR", { message: "Room not found" });
            return;
          }

          await prisma.pvpRoomMember.update({
            where: { roomId_userId: { roomId: room.id, userId: ws.user.userId } },
            data: { leftAt: new Date(), readyAt: null },
          }).catch(() => null);

          if (redis) {
            await redis.del(buildRoomReconnectKey(room.id, ws.user.userId));
          }

          ws.roomCode = undefined;
          await transferRoomHostIfNeeded(prisma, room.id);
          await touchRoomExpiry(prisma, room.id);
          await broadcastRoomState(prisma, wss, code);
          if (room.visibility === "PUBLIC") {
            await maybeAutoStartPublicRoom(code);
          }

          await storeIdempotencyHit({
            redis,
            store: idempotencyStore,
            key: idempotency?.key,
            messageType: msg.type,
            value: { response: null },
          });

          return;
        }

      } catch (e) {
        if (metricMessageType === "HELLO") {
          gatewayMetrics?.incrementWsHandshake("failure");
        }
        const requestId = parsedMessage.success && "requestId" in parsedMessage.data ? parsedMessage.data.requestId : undefined;
        const errorPayload = toClientErrorPayload(e, {
          message: e instanceof Error ? e.message : "Unknown error",
          retryable: parsedMessage.success ? parsedMessage.data.type === "QUEUE_JOIN" : undefined,
          details: {
            requestId,
            phase: parsedMessage.success ? parsedMessage.data.type.toLowerCase() : "message_handler",
          },
        });
        gatewayLogError("Websocket message handler failed", e, {
          userId: ws.user?.userId,
          ip: ws.ip ?? "unknown",
          messageType: parsedMessage.success ? parsedMessage.data.type : "unknown",
          requestId,
          connectionId: ws.connectionId,
        });
        send(ws, "ERROR", errorPayload);
        if (parsedMessage.success && parsedMessage.data.type === "QUEUE_JOIN") {
          send(ws, "QUEUE_STATUS", { status: "IDLE" });
        }
      } finally {
        gatewayMetrics?.recordWsMessage({
          direction: "in",
          type: metricMessageType,
          durationSeconds: Number(process.hrtime.bigint() - messageStartedAt) / 1_000_000_000,
        });
      }
    });

    ws.on("close", () => {
      gatewayLogDebug("Websocket connection closed", {
        userId: ws.user?.userId,
        ip: ws.ip ?? "unknown",
        matchId: ws.matchId,
        roomCode: ws.roomCode,
      });
      messageBatcher?.drop(ws);
      if (pingInterval) clearInterval(pingInterval);
      if (ws.presenceInterval) clearInterval(ws.presenceInterval);
      if (ws.ip) {
        const next = Math.max(0, (activeConnectionsByIp.get(ws.ip) ?? 1) - 1);
        if (next === 0) {
          activeConnectionsByIp.delete(ws.ip);
        } else {
          activeConnectionsByIp.set(ws.ip, next);
        }
      }
      gatewayMetrics?.setConnectionsActive(wss.clients.size);
      if (ws.user) {
        state.removeFromQueue(ws.user.userId);
        state.clearQueueTimeout(ws.user.userId);
        void queueLeave(ws.user.userId);
        releaseMatchSession(ws);
        if (ws.matchId) {
          matchCache?.removeSocket(ws.matchId, ws);
        }

        const otherSockets = getAuthedSocketsForUser(wss, ws.user.userId).filter((socket) => socket !== ws);
        if (otherSockets.length === 0) {
          const activeMatch = findActiveMatchByUserId(state, ws.user.userId);
          if (
            activeMatch &&
            shouldScheduleDisconnectForfeit({
              policy: getDisconnectForfeitPolicy({
                roomCode: activeMatch.roomCode,
                participantCount: activeMatch.participants.size,
              }),
              participantCount: activeMatch.participants.size,
              otherActiveSocketsForUser: otherSockets.length,
              matchState: activeMatch.state,
              matchStatus: activeMatch.status,
            })
          ) {
            const reconnectUntilMs = Date.now() + DISCONNECT_FORFEIT_GRACE_MS;
            activeMatch.reconnectUntilByUserId = activeMatch.reconnectUntilByUserId ?? {};
            activeMatch.reconnectUntilByUserId[ws.user.userId] = reconnectUntilMs;
            scheduleDisconnectForfeit(activeMatch.matchId, ws.user.userId);
            void persistReconnectGraceWindow(activeMatch.matchId, ws.user.userId, reconnectUntilMs).catch((error) => {
              gatewayLogWarn("Failed to persist reconnect grace window", {
                matchId: activeMatch.matchId,
                userId: ws.user?.userId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
        }
      }

      if (ws.user && ws.roomCode) {
        const code = ws.roomCode;
        void (async () => {
          const room = await prisma.pvpRoom.findUnique({
            where: { code },
            select: { id: true, code: true, status: true, visibility: true },
          });
          if (!room) return;

          if (room.status === "OPEN" && redis) {
            await redis.set(
              buildRoomReconnectKey(room.id, ws.user!.userId),
              INSTANCE_ID,
              "EX",
              Math.ceil(ROOM_RECONNECT_GRACE_MS / 1000)
            );
            return;
          }

          await prisma.pvpRoomMember.update({
            where: { roomId_userId: { roomId: room.id, userId: ws.user!.userId } },
            data: { leftAt: new Date() },
          }).catch(() => null);

          await transferRoomHostIfNeeded(prisma, room.id);
          await broadcastRoomState(prisma, wss, code);
          if (room.visibility === "PUBLIC") {
            await maybeAutoStartPublicRoom(code);
          }
        })().catch(() => {
          // ignore
        });
      }
    });
  });

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  let shutdownPromise: Promise<void> | null = null;
  const beginGracefulShutdown = (signal: string) => {
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
      await flushPendingInputUpdates("shutdown");

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
      clearInterval(roomLifecycleSweepInterval);
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
      for (const interval of state.aiIntervals.values()) {
        clearInterval(interval);
      }
      state.aiIntervals.clear();

      await Promise.allSettled([serverClosed, websocketClosed]);
      await Promise.allSettled([redisBus?.close(), prisma.$disconnect()]);

      gatewayLogInfo("Graceful shutdown complete", {
        signal,
        instanceId: INSTANCE_ID,
      });
    })().catch((error) => {
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

  server.listen(PORT, () => {
    gatewayLogInfo("PvP gateway listening", { port: PORT, instanceId: INSTANCE_ID });
  });
}

void main().catch((error) => {
  gatewayLogError("PvP gateway failed to start", error, {
    instanceId: INSTANCE_ID,
  });
  throw error;
});
