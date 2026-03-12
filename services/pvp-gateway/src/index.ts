import "./load-env";

import crypto from "crypto";
import fs from "fs";
import http from "http";
import https from "https";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { PrismaClient } from "@prisma/client";

import { safeParseClientMessage, toJson, type ServerMessage } from "./protocol";
import { verifyWsToken, type AuthedUser } from "./auth";
import { InMemoryState, type ConnectionUser } from "./state";
import { updateElo1v1 } from "./mmr";
import { createAiProfile, estimatePlayerSkill, mulberry32, ratingFromWpm } from "./ai";
import { createTokenBucket, tryConsume, type TokenBucket } from "./rate-limit";
import { createRedisBus, matchChannel, roomChannel, userChannel, type RedisBus } from "./redis-bus";
import { incrementGatewayMetric, observeGatewayHistogram, renderGatewayMetrics, setGatewayGauge } from "./metrics";
import { createGatewayEventBus } from "./events";
import { buildIdempotencyKey, getIdempotencyRecord, getIdempotencyTtlSeconds, InMemoryIdempotencyStore, setIdempotencyRecord, type IdempotencyRecord } from "./idempotency";
import { buildDisconnectForfeitOutcome, runDisconnectForfeitSequence } from "./disconnect-forfeit";
import { enqueueOrMatchInMemory } from "./in-memory-queue";
import { shouldAcceptInputUpdate } from "./input-update";
import { createLocalLock } from "./local-lock";
import { matchStateFromDbStatus, matchStateToDbStatus, matchStateToLegacyStatus, transitionMatchState, type MatchLifecycleState } from "./match-fsm";
import { buildMatchStatePayload, buildProgressPayload, bumpMatchRevision, markMatchSnapshotBroadcast, shouldBroadcastPeriodicMatchSnapshot } from "./match-sync";
import { createMessageBatcher, isBatchableServerMessage } from "./message-batcher";
import { invalidatePvpSelfCaches } from "./pvp-rating-cache";
import { getDisconnectForfeitPolicy, getStaleMatchAbortReason, shouldRejectDuplicateMatchTab, shouldScheduleDisconnectForfeit } from "./match-session-guards";
import { sanitizeAvatarUrl, sanitizeDisplayName, sanitizeRoomCode, sanitizeUserAgent } from "../../../src/lib/sanitize";
import { gatewayLogger } from "../../../src/log/gatewayLogger";
import { canJoinPvpMatchSocket, isTerminalPvpMatchStatus } from "../../../src/features/pvp/server/match-access";

const IS_PROD = process.env.NODE_ENV === "production";
const INSTANCE_ID = process.env.PVP_INSTANCE_ID ?? crypto.randomUUID();

let redisBus: RedisBus | null = null;
let messageBatcher: ReturnType<typeof createMessageBatcher<WsConn>> | null = null;
const WS_BATCH_FLUSH_SIZE_BUCKETS = [1, 2, 4, 8, 16, 32, 64];
const WS_MESSAGE_SIZE_BUCKETS = [64, 128, 256, 512, 1024, 2048, 4096, 8192];
const DISCONNECT_FORFEIT_GRACE_MS = envInt("PVP_DISCONNECT_FORFEIT_GRACE_MS", 10_000);
const MATCH_RESULT_RETENTION_MS = envMs("PVP_MATCH_RESULT_RETENTION_MS", 5 * 60 * 1000);
const MATCH_SWEEP_INTERVAL_MS = envMs("PVP_MATCH_SWEEP_INTERVAL_MS", 30_000);
const MATCH_MAX_COUNTDOWN_AGE_MS = envMs("PVP_MATCH_MAX_COUNTDOWN_AGE_MS", 2 * 60 * 1000);
const MATCH_MAX_LIVE_AGE_MS = envMs("PVP_MATCH_MAX_LIVE_AGE_MS", 30 * 60 * 1000);
const matchFinalizationLocks = new Set<string>();
const matchCleanupTimers = new Map<string, NodeJS.Timeout>();

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

function gatewayLogError(message: string, error: unknown, meta?: Record<string, unknown>) {
  gatewayLogger.error(`[PVP-GATEWAY] ${message}`, error, meta);
}

type WsConn = WebSocket & {
  connectionId?: string;
  user?: AuthedUser;
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

    if (path === "/metrics") {
      setGatewayGauge("pvp_gateway_uptime_seconds", Number(process.uptime().toFixed(3)));
      setGatewayGauge("pvp_gateway_heap_used_bytes", process.memoryUsage().heapUsed);
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(renderGatewayMetrics());
      return;
    }

    if (path === "/healthz" || path === "/") {
      res.writeHead(200);
      res.end("pvp-gateway ok");
      return;
    }

    res.writeHead(404);
    res.end("not found");
  };

  if (!IS_PROD) {
    return http.createServer(healthHandler);
  }

  const keyPath = process.env.PVP_TLS_KEY_PATH;
  const certPath = process.env.PVP_TLS_CERT_PATH;
  if (!keyPath || !certPath) {
    throw new Error("Missing PVP_TLS_KEY_PATH or PVP_TLS_CERT_PATH in production");
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

  if ((req.socket as { encrypted?: boolean }).encrypted) return true;

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
  if (redisBus) {
    void redisBus.publish(matchChannel(matchId), { type, payload });
    return;
  }
  wss.clients.forEach((client: WebSocket) => {
    const c = client as WsConn;
    if (c.matchId !== matchId) return;
    send(c, type, payload);
  });
}

function getDisconnectForfeitKey(matchId: string, userId: string) {
  return `${matchId}:${userId}`;
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
  broadcastMatch(wss, match.matchId, "MATCH_STATE", buildMatchStatePayload(match, nowMs));
  return true;
}

function countErrors(text: string, input: string) {
  let e = 0;
  const n = Math.min(text.length, input.length);
  for (let i = 0; i < n; i += 1) {
    if (text[i] !== input[i]) e += 1;
  }
  return e;
}

function computeAccuracy(text: string, input: string) {
  const n = Math.min(text.length, input.length);
  if (n === 0) return 100;
  let correct = 0;
  for (let i = 0; i < n; i += 1) {
    if (text[i] === input[i]) correct += 1;
  }
  return Math.max(0, Math.min(100, Number(((correct / Math.max(1, input.length)) * 100).toFixed(1))));
}

function computeWpm(text: string, input: string, startedAtMs: number, nowMs: number) {
  const elapsedMs = Math.max(1, nowMs - startedAtMs);
  const minutes = elapsedMs / 60000;

  let correct = 0;
  const n = Math.min(text.length, input.length);
  for (let i = 0; i < n; i += 1) {
    if (text[i] === input[i]) correct += 1;
  }

  const base = (correct / 5) / Math.max(minutes, 0.016667);
  return Math.max(0, Math.min(500, Math.round(base)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function envMs(name: string, fallbackMs: number) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallbackMs;
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

async function restoreRoomAfterMatch(prisma: PrismaClient, wss: WebSocketServer, roomCode: string) {
  const room = await prisma.pvpRoom.findUnique({
    where: { code: roomCode },
    select: { id: true, code: true, status: true, maxPlayers: true },
  });
  if (!room) return;

  await prisma.$transaction([
    prisma.pvpRoom.update({
      where: { id: room.id },
      data: { status: "OPEN" },
    }),
    prisma.pvpRoomMember.updateMany({
      where: { roomId: room.id, leftAt: null },
      data: { readyAt: null },
    }),
  ]);

  const members = await prisma.pvpRoomMember.findMany({
    where: { roomId: room.id, leftAt: null },
    orderBy: { joinedAt: "asc" },
    select: {
      userId: true,
      colorSlot: true,
      readyAt: true,
      user: { select: { username: true, profile: { select: { avatar: true } } } },
    },
  });

  broadcastRoom(wss, roomCode, "ROOM_STATE", {
    room: {
      code: room.code,
      status: "OPEN",
      maxPlayers: room.maxPlayers,
      members: members.map((member) => ({
        userId: member.userId,
        username: sanitizeDisplayName(member.user.username, 32) || "user",
        avatar: sanitizeAvatarUrl(member.user.profile?.avatar ?? null),
        slot: member.colorSlot,
        ready: false,
      })),
    },
  });
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

  broadcastMatch(params.wss, match.matchId, "RESULTS", {
    matchId: match.matchId,
    placements: params.placements,
    ratingChanges,
  });

  await invalidatePvpSelfCaches(
    redisBus?.redis ?? null,
    ratingChanges.map((change) => change.userId)
  );

  match.finalizedAtMs = Date.now();
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
}) {
  const match = params.state.matches.get(params.matchId);
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;
  if (!tryBeginMatchFinalization(params.matchId)) return;

  try {
    match.endedReason = "aborted";
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
        startedAt: new Date(match.serverStartAtMs),
        endedAt: new Date(),
      },
    });

    for (const participant of match.participants.values()) {
      if (isAiUserId(participant.userId)) continue;
      sendToUser(params.wss, participant.userId, "MATCH_ENDED", {
        matchId: match.matchId,
        reason: "aborted",
        message: params.reasonMessage,
        finalResultsPending: false,
      });
    }

    match.finalizedAtMs = Date.now();
    scheduleMatchCleanup(params.state, match.matchId);

    if (match.roomCode) {
      await restoreRoomAfterMatch(params.prisma, params.wss, match.roomCode);
    }
  } finally {
    endMatchFinalization(params.matchId);
  }
}

async function startAiSimulation(params: {
  prisma: PrismaClient;
  wss: WebSocketServer;
  state: InMemoryState;
  eventBus: ReturnType<typeof createGatewayEventBus>;
  matchId: string;
  humanId: string;
  aiUserId: string;
  snapshotIntervalMs: number;
  persistSimUserToDb?: boolean;
  forceFinishHumanAfterMs?: number;
}) {
  const match = params.state.matches.get(params.matchId);
  if (!match) return;

  const ai = match.participants.get(params.aiUserId);
  const human = match.participants.get(params.humanId);
  if (!ai || !human) return;

  // Estimate player skill from avg/best/recent stats.
  const skill = await estimatePlayerSkill(params.prisma, params.humanId);
  const seed = Array.from(params.matchId).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const rand = mulberry32(seed);
  const profile = createAiProfile(skill, Math.floor(rand() * 1_000_000));

  const shouldForceFinishHuman = isAiUserId(params.aiUserId) && (params.forceFinishHumanAfterMs ?? 30_000) > 0;
  const forceFinishDelayMs = params.forceFinishHumanAfterMs ?? 30_000;

  const tickMs = 120;
  const maxSpeedFactor = 1.16;
  const minSpeedFactor = 0.84;
  let speedFactor = 1;

  const interval = setInterval(async () => {
    const current = params.state.matches.get(params.matchId);
    if (!current) {
      params.state.clearAiInterval(params.matchId);
      return;
    }

    const nowMs = Date.now();
    if (nowMs < current.serverStartAtMs) return;
    if (current.state === "countdown") {
      applyMatchTransition({ match: current, nextState: "live", eventBus: params.eventBus, reason: "completed" });
    }
    if (current.state === "finished") {
      params.state.clearAiInterval(params.matchId);
      return;
    }

    const aiNow = current.participants.get(params.aiUserId);
    const humanNow = current.participants.get(params.humanId);
    if (!aiNow || !humanNow) {
      params.state.clearAiInterval(params.matchId);
      return;
    }

    // Dynamic difficulty: if human is behind, reduce AI speed a bit; if ahead, slightly increase.
    const gap = humanNow.input.length - aiNow.input.length;
    const desiredAdjust = clamp(gap / 1200, -0.06, 0.06);
    speedFactor = clamp(speedFactor + desiredAdjust, minSpeedFactor, maxSpeedFactor);

    // Volatility wobble.
    const wobble = 1 + (rand() - 0.5) * 2 * profile.volatility;
    const effectiveWpm = clamp(profile.targetWpm * speedFactor * wobble, 10, 260);

    const elapsedSec = (nowMs - current.serverStartAtMs) / 1000;
    const charsPerSec = (effectiveWpm * 5) / 60;
    const targetChars = Math.floor(charsPerSec * elapsedSec);

    // Human-like corrections: small occasional backstep.
    let nextIndex = clamp(targetChars, 0, current.textSnapshot.length);
    if (rand() < 0.03 && nextIndex > 6) {
      nextIndex = Math.max(0, nextIndex - (1 + Math.floor(rand() * 3)));
    }

    // Never jump too far ahead instantly.
    nextIndex = Math.min(current.textSnapshot.length, Math.max(aiNow.input.length - 3, Math.min(aiNow.input.length + 12, nextIndex)));

    aiNow.input = current.textSnapshot.slice(0, nextIndex);
    aiNow.seq += 1;
    aiNow.errors = Math.max(0, Math.round(((100 - profile.accuracyPct) / 100) * aiNow.input.length * 0.08));
    aiNow.accuracy = clamp(profile.accuracyPct - (rand() * 1.2), 80, 99.9);
    aiNow.wpm = Math.round(effectiveWpm);

    if (aiNow.input.length >= current.textSnapshot.length && aiNow.finishedAt == null) {
      aiNow.finishedAt = nowMs;

      if (params.persistSimUserToDb) {
        void params.prisma.pvpParticipant
          .update({
            where: { matchId_userId: { matchId: current.matchId, userId: aiNow.userId } },
            data: {
              finalWpm: aiNow.wpm,
              finalAccuracy: aiNow.accuracy,
              finalErrors: aiNow.errors,
              timeSpentSec: Math.max(0, Math.floor((aiNow.finishedAt - current.serverStartAtMs) / 1000)),
              completedAt: new Date(aiNow.finishedAt),
            },
          })
          .catch(() => {
            // ignore
          });
      }

      // If the human is still typing, give them a grace period then force-finish to avoid a stuck match.
      if (shouldForceFinishHuman) setTimeout(() => {
        const mm = params.state.matches.get(params.matchId);
        if (!mm) return;
        const h = mm.participants.get(params.humanId);
        const a = mm.participants.get(params.aiUserId);
        if (!h || !a) return;
        if (mm.state === "finished") return;
        if (h.finishedAt != null) return;

        h.finishedAt = Date.now();
        void params.prisma.pvpParticipant
          .update({
            where: { matchId_userId: { matchId: mm.matchId, userId: h.userId } },
            data: {
              finalWpm: h.wpm,
              finalAccuracy: h.accuracy,
              finalErrors: h.errors,
              timeSpentSec: Math.max(0, Math.floor((h.finishedAt - mm.serverStartAtMs) / 1000)),
              completedAt: new Date(h.finishedAt),
            },
          })
          .then(() =>
            finalizeMatchIfComplete({
              prisma: params.prisma,
              wss: params.wss,
              state: params.state,
              eventBus: params.eventBus,
              matchId: mm.matchId,
            })
          )
          .catch(() => {
            // ignore
          });
      }, forceFinishDelayMs);
    }

    // Broadcast AI progress
    bumpMatchRevision(current);
    broadcastMatch(params.wss, current.matchId, "PROGRESS", {
      ...buildProgressPayload(current, aiNow, nowMs),
    });

    maybeBroadcastMatchSnapshot(params.wss, current, nowMs, params.snapshotIntervalMs);

    if (aiNow.finishedAt != null) {
      await finalizeMatchIfComplete({
        prisma: params.prisma,
        wss: params.wss,
        state: params.state,
        eventBus: params.eventBus,
        matchId: current.matchId,
      });
    }
  }, tickMs);

  params.state.aiIntervals.set(params.matchId, interval);
}

async function main() {
  const PORT = envInt("PORT", 8787);
  const prisma = new PrismaClient();
  const state = new InMemoryState();
  const eventBus = createGatewayEventBus();
  const localQueueLock = createLocalLock();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const disconnectForfeitTimers = new Map<string, NodeJS.Timeout>();
  const rematchStartedByMatchId = new Set<string>();

  gatewayLogInfo("Starting PvP gateway", {
    port: PORT,
    environment: process.env.NODE_ENV ?? "development",
    instanceId: INSTANCE_ID,
  });

  const AI_QUEUE_TIMEOUT_MS = envMs("PVP_AI_QUEUE_TIMEOUT_MS", 25_000);
  const WS_PING_INTERVAL_MS = envInt("PVP_WS_PING_INTERVAL_MS", 15_000);
  const DEV = process.env.NODE_ENV !== "production";
  const TEST_FORCE_BOT_MATCH = DEV && envBool("PVP_TEST_FORCE_BOT_MATCH", false);

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
      }
    },
  });
  const activeConnectionsByIp = new Map<string, number>();
  const connectionAttemptBuckets = new Map<string, TokenBucket>();
  const roomActionLastSeen = new Map<string, number>();
  const activeMatchSessions = new Map<string, WsConn>();

  const clearDisconnectForfeitTimer = (matchId: string, userId: string) => {
    const key = getDisconnectForfeitKey(matchId, userId);
    const existing = disconnectForfeitTimers.get(key);
    if (!existing) return;
    clearTimeout(existing);
    disconnectForfeitTimers.delete(key);
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
      startDelayMs: 3500,
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
    ws.matchSessionKey = undefined;
  };

  const claimMatchSession = (matchId: string, userId: string, ws: WsConn) => {
    const key = `${matchId}:${userId}`;
    const existing = activeMatchSessions.get(key);
    const hasOpenExistingSession = Boolean(existing && existing !== ws && existing.readyState === WebSocket.OPEN);

    if (existing && shouldRejectDuplicateMatchTab(hasOpenExistingSession ? 1 : 0)) {
      send(existing, "ERROR", { message: "This match was opened in another tab" });
      existing.close(4001, "Superseded by a newer match session");
    }

    if (ws.matchSessionKey && ws.matchSessionKey !== key) {
      releaseMatchSession(ws);
    }

    activeMatchSessions.set(key, ws);
    ws.matchSessionKey = key;
  };

  const sweepStaleMatches = async () => {
    const now = Date.now();

    for (const [matchId, match] of state.matches.entries()) {
      if ((match.state === "finished" || match.state === "aborted") && match.finalizedAtMs && now - match.finalizedAtMs >= MATCH_RESULT_RETENTION_MS) {
        clearScheduledMatchCleanup(matchId);
        state.clearAiInterval(matchId);
        state.matches.delete(matchId);
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
        for (const userId of match.participants.keys()) {
          clearDisconnectForfeitTimer(matchId, userId);
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

  const snapshotGatewayMetrics = () => {
    let activeMatches = 0;
    for (const match of state.matches.values()) {
      if (match.state === "finished" || match.state === "aborted") continue;
      activeMatches += 1;
    }

    setGatewayGauge("pvp_active_connections", wss.clients.size);
    setGatewayGauge("pvp_queue_depth", state.queue.length);
    setGatewayGauge("pvp_active_matches", activeMatches);
    setGatewayGauge("pvp_gateway_uptime_seconds", Number(process.uptime().toFixed(3)));
    setGatewayGauge("pvp_gateway_heap_used_bytes", process.memoryUsage().heapUsed);
  };

  snapshotGatewayMetrics();
  const metricSnapshotInterval = setInterval(snapshotGatewayMetrics, METRIC_SNAPSHOT_INTERVAL_MS);
  if (typeof metricSnapshotInterval.unref === "function") {
    metricSnapshotInterval.unref();
  }

  const USE_REDIS = envBool("PVP_USE_REDIS", false);
  const REDIS_URL = process.env.PVP_REDIS_URL ?? process.env.REDIS_URL ?? null;

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
        wss.clients.forEach((client: WebSocket) => {
          const c = client as WsConn;
          if (c.matchId !== matchId) return;
          send(c, msg.type as ServerMessage["type"], msg.payload);
        });
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
  const ONLINE_KEY_PREFIX = "pvp:online:";
  const ONLINE_TTL_SEC = envInt("PVP_ONLINE_TTL_SEC", 90);
  const PRESENCE_REFRESH_MS = Math.max(5_000, Math.floor((ONLINE_TTL_SEC * 1000) / 3));

  const QUEUE_KEY = "pvp:queue:ranked:1v1";
  const QUEUE_RATING_RANGE = envInt("PVP_QUEUE_RATING_RANGE", 200);

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

  async function markOnline(userId: string) {
    if (!redis) return;
    await redis.set(`${ONLINE_KEY_PREFIX}${userId}`, INSTANCE_ID, "EX", ONLINE_TTL_SEC);
  }

  async function queueLeave(userId: string) {
    if (!redis) return;
    await redis.zrem(QUEUE_KEY, userId);
  }

  async function queueJoin(user: AuthedUser) {
    if (!redis) return;
    await redis.zadd(QUEUE_KEY, String(user.pvpRating), user.userId);
  }

  async function tryMatchQueuedUser(user: AuthedUser): Promise<string | null> {
    if (!redis) return null;
    const minR = user.pvpRating - QUEUE_RATING_RANGE;
    const maxR = user.pvpRating + QUEUE_RATING_RANGE;
    const otherId = (await redis.eval(
      QUEUE_MATCH_LUA,
      1,
      QUEUE_KEY,
      user.userId,
      String(minR),
      String(maxR),
      ONLINE_KEY_PREFIX
    )) as string | null;
    return otherId && typeof otherId === "string" ? otherId : null;
  }

  const AI_REMATCH_COOLDOWN_MS = envMs("PVP_AI_REMATCH_COOLDOWN_MS", 20 * 60 * 1000);
  const aiRematchRefuseUntilByHumanId = new Map<string, number>();
  const rematchAcceptedByMatchId = new Map<string, Set<string>>();

  async function loadConnectionUser(userId: string): Promise<ConnectionUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, profile: { select: { avatar: true } } },
    });

    const rating = await prisma.pvpRating.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: { rating: true, deviation: true },
    });

    return {
      userId,
      username: sanitizeDisplayName(user?.username ?? "user", 32) || "user",
      avatar: sanitizeAvatarUrl(user?.profile?.avatar ?? null),
      pvpRating: rating.rating,
      pvpDeviation: rating.deviation,
    };
  }

  async function createRanked1v1Match(params: {
    users: Array<(ConnectionUser & { slot: number })>;
    persistUserIds: string[];
    startDelayMs?: number;
  }) {
    const match = await prisma.pvpMatch.create({
      data: { status: "PENDING", textSnapshot: "placeholder" },
      select: { id: true },
    });

    const serverStartAtMs = Date.now() + (params.startDelayMs ?? 3500);
    const local = state.createLocalMatch({
      matchId: match.id,
      roomCode: null,
      users: params.users,
      serverStartAtMs,
    });
    eventBus.emit("match:countdown", {
      matchId: match.id,
      from: "lobby",
      to: "countdown",
      roomCode: null,
      atMs: local.stateChangedAt,
    });

    await prisma.pvpMatch.update({
      where: { id: match.id },
      data: {
        status: "COUNTDOWN",
        textSnapshot: local.textSnapshot,
        serverStartAt: new Date(serverStartAtMs),
      },
    });

    if (params.persistUserIds.length) {
      await prisma.pvpParticipant.createMany({
        data: params.persistUserIds.map((userId) => ({
          matchId: match.id,
          userId,
          slot: params.users.find((u) => u.userId === userId)?.slot ?? 0,
        })),
        skipDuplicates: true,
      });
    }

    const payload = {
      matchId: match.id,
      textSnapshot: local.textSnapshot,
      serverStartAt: new Date(serverStartAtMs).toISOString(),
      players: Array.from(local.participants.values()).map((p) => ({
        userId: p.userId,
        username: p.username,
        avatar: p.avatar,
        slot: p.slot,
      })),
    };

    for (const u of params.users) {
      if (isAiUserId(u.userId)) continue;
      sendToUser(wss, u.userId, "MATCH_FOUND", payload);
    }

    return { matchId: match.id, local, serverStartAtMs };
  }

  const resendExistingRematch = (matchId: string, userId: string) => {
    const rematch = state.matches.get(matchId);
    if (!rematch) return false;

    sendToUser(wss, userId, "MATCH_FOUND", {
      matchId: rematch.matchId,
      textSnapshot: rematch.textSnapshot,
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

    if (!isSecureGatewayRequest(req)) {
      incrementGatewayMetric("ws_connection_rejected", { reason: "insecure_transport" });
      ws.close(1008, "Secure websocket required");
      return;
    }

    if (!originAllowed(req.headers.origin)) {
      incrementGatewayMetric("ws_connection_rejected", { reason: "origin_not_allowed" });
      ws.close(1008, "Origin not allowed");
      return;
    }

    const ip = getClientIp(req);
    ws.ip = ip;
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
      incrementGatewayMetric("ws_connection_rejected", { reason: "connection_attempt_rate_limit", ip });
      ws.close(1013, "Too many connection attempts");
      return;
    }

    const activeForIp = activeConnectionsByIp.get(ip) ?? 0;
    if (activeForIp >= WS_MAX_CONNECTIONS_PER_IP) {
      incrementGatewayMetric("ws_connection_rejected", { reason: "connection_cap", ip });
      ws.close(1013, "Too many active connections");
      return;
    }
    activeConnectionsByIp.set(ip, activeForIp + 1);

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
      incrementGatewayMetric("pvp_ws_inbound_messages_total", { type: msg.type });

      if (msg.type === "INPUT_UPDATE" && ws.rl && !tryConsume(ws.rl.input, 1, nowMs)) {
        incrementGatewayMetric("ws_rate_limit_rejected", { reason: "input_message_rate" });
        // Do not close immediately; ignore input spam.
        return;
      }

      try {
        if (msg.type === "HELLO") {
          const authed = await verifyWsToken(msg.payload.token, {
            prisma,
            clientSecret: msg.payload.clientSecret,
            userAgent: sanitizeUserAgent(req.headers["user-agent"] ?? null),
          });
          const user = (await loadConnectionUser(authed.userId)) as AuthedUser;
          ws.user = user;

          gatewayLogInfo("Websocket client authenticated", {
            userId: user.userId,
            ip: ws.ip ?? "unknown",
          });

          await markOnline(user.userId);
          if (redis) {
            ws.presenceInterval = setInterval(() => {
              if (!ws.user) return;
              void markOnline(ws.user.userId);
            }, PRESENCE_REFRESH_MS);
          }

          send(ws, "HELLO_OK", { user: { userId: user.userId, username: user.username, avatar: user.avatar } });
          return;
        }

        if (msg.type === "AUTH_REFRESH") {
          if (!ws.user) {
            send(ws, "ERROR", { message: "Unauthenticated" });
            return;
          }

          await verifyWsToken(msg.payload.token, {
            prisma,
            clientSecret: msg.payload.clientSecret,
            userAgent: sanitizeUserAgent(req.headers["user-agent"] ?? null),
            expectedUserId: ws.user.userId,
          });

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
          gatewayLogDebug("Queue join requested", {
            userId: ws.user.userId,
            requestId: "requestId" in msg ? msg.requestId : undefined,
            useRedis: Boolean(redis),
          });
          // Dev TEST: force a match vs a real DB-backed bot user (exercise human-vs-human path).
          if (TEST_FORCE_BOT_MATCH) {
            const bot = await ensureTestBot();
            const me = ws.user;

            if (me.userId === bot.userId) {
              send(ws, "ERROR", { message: "TEST bot cannot match itself" });
              return;
            }

            state.removeFromQueue(me.userId);
            state.clearQueueTimeout(me.userId);

            const match = await prisma.pvpMatch.create({
              data: { status: "PENDING", textSnapshot: "placeholder" },
              select: { id: true },
            });

            const serverStartAtMs = Date.now() + 3500;
            const local = state.createLocalMatch({
              matchId: match.id,
              roomCode: null,
              users: [
                { ...me, slot: 0 },
                { ...bot, slot: 1 },
              ],
              serverStartAtMs,
            });

            await prisma.pvpMatch.update({
              where: { id: match.id },
              data: {
                status: "COUNTDOWN",
                textSnapshot: local.textSnapshot,
                serverStartAt: new Date(serverStartAtMs),
              },
            });

            await prisma.pvpParticipant.createMany({
              data: [
                { matchId: match.id, userId: me.userId, slot: 0 },
                { matchId: match.id, userId: bot.userId, slot: 1 },
              ],
              skipDuplicates: true,
            });

            sendToUser(wss, me.userId, "MATCH_FOUND", {
              matchId: match.id,
              textSnapshot: local.textSnapshot,
              serverStartAt: new Date(serverStartAtMs).toISOString(),
              players: Array.from(local.participants.values()).map((p) => ({
                userId: p.userId,
                username: p.username,
                avatar: p.avatar,
                slot: p.slot,
              })),
            });

            await startAiSimulation({
              prisma,
              wss,
              state,
              eventBus,
              matchId: match.id,
              humanId: me.userId,
              aiUserId: bot.userId,
              snapshotIntervalMs: MATCH_SNAPSHOT_INTERVAL_MS,
              persistSimUserToDb: true,
              forceFinishHumanAfterMs: 0,
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

          const me = ws.user;
          await markOnline(me.userId);

          // Redis-backed queue + atomic pairing (multi-instance safe)
          if (redis) {
            state.clearQueueTimeout(me.userId);
            await queueJoin(me);

            const otherId = await tryMatchQueuedUser(me);
            if (otherId) {
              const other = await loadConnectionUser(otherId);

              await createRanked1v1Match({
                users: [
                  { ...other, slot: 0 },
                  { ...me, slot: 1 },
                ],
                persistUserIds: [other.userId, me.userId],
                startDelayMs: 4000,
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

            // Fallback: after a timeout, start a match vs AI (and remove from Redis queue first).
            const timeout = setTimeout(() => {
              const userId = ws.user?.userId;
              if (!userId) return;

              // If there is no live socket, just clean up queue membership.
              const sockets = getAuthedSocketsForUser(wss, userId);
              if (sockets.length === 0) {
                void queueLeave(userId);
                state.clearQueueTimeout(userId);
                return;
              }

              void (async () => {
                const removed = await redis.zrem(QUEUE_KEY, userId);
                if (removed === 0) return; // matched or left already

                state.clearQueueTimeout(userId);
                const human = await loadConnectionUser(userId);

                const match = await prisma.pvpMatch.create({
                  data: { status: "PENDING", textSnapshot: "placeholder" },
                  select: { id: true },
                });

                const serverStartAtMs = Date.now() + 3500;
                const aiUserId = `ai:${match.id}`;

                const local = state.createLocalMatch({
                  matchId: match.id,
                  roomCode: null,
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
                  serverStartAtMs,
                });

                await prisma.pvpMatch.update({
                  where: { id: match.id },
                  data: {
                    status: "COUNTDOWN",
                    textSnapshot: local.textSnapshot,
                    serverStartAt: new Date(serverStartAtMs),
                  },
                });

                await prisma.pvpParticipant.createMany({
                  data: [{ matchId: match.id, userId: human.userId, slot: 0 }],
                  skipDuplicates: true,
                });

                // Notify the human only (AI has no socket).
                sendToUser(wss, human.userId, "MATCH_FOUND", {
                  matchId: match.id,
                  textSnapshot: local.textSnapshot,
                  serverStartAt: new Date(serverStartAtMs).toISOString(),
                  players: Array.from(local.participants.values()).map((p) => ({
                    userId: p.userId,
                    username: p.username,
                    avatar: p.avatar,
                    slot: p.slot,
                  })),
                });

                await startAiSimulation({
                  prisma,
                  wss,
                  state,
                  eventBus,
                  matchId: match.id,
                  humanId: human.userId,
                  aiUserId,
                  snapshotIntervalMs: MATCH_SNAPSHOT_INTERVAL_MS,
                });
              })().catch((e) => {
                const message = e instanceof Error ? e.message : "AI fallback failed";
                sendToUser(wss, userId, "ERROR", { message });
                sendToUser(wss, userId, "QUEUE_STATUS", { status: "IDLE" });
              });
            }, AI_QUEUE_TIMEOUT_MS);

            state.queueTimeouts.set(me.userId, timeout);
            send(ws, "QUEUE_STATUS", { status: "SEARCHING" });
            return;
          }

          await localQueueLock.runExclusive(async () => {
            state.removeFromQueue(ws.user!.userId);
            state.clearQueueTimeout(ws.user!.userId);
            const queueResult = enqueueOrMatchInMemory({
              queue: state.queue,
              user: ws.user!,
              ratingRange: 200,
            });

            if (queueResult.kind === "matched") {
              const [other, currentUser] = queueResult.users;
              state.clearQueueTimeout(currentUser.userId);
              state.clearQueueTimeout(other.userId);

              await createRanked1v1Match({
                users: [
                  { ...other, slot: 0 },
                  { ...currentUser, slot: 1 },
                ],
                persistUserIds: [other.userId, currentUser.userId],
                startDelayMs: 4000,
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

            const timeout = setTimeout(() => {
              const userId = ws.user?.userId;
              if (!userId) return;
              const stillQueued = state.queue.find((e) => e.user.userId === userId);
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
                const match = await prisma.pvpMatch.create({
                  data: { status: "PENDING", textSnapshot: "placeholder" },
                  select: { id: true },
                });

                const serverStartAtMs = Date.now() + 3500;
                const aiUserId = `ai:${match.id}`;

                const local = state.createLocalMatch({
                  matchId: match.id,
                  roomCode: null,
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
                  serverStartAtMs,
                });
                eventBus.emit("match:countdown", {
                  matchId: match.id,
                  from: "lobby",
                  to: "countdown",
                  roomCode: null,
                  atMs: local.stateChangedAt,
                });

                await prisma.pvpMatch.update({
                  where: { id: match.id },
                  data: {
                    status: "COUNTDOWN",
                    textSnapshot: local.textSnapshot,
                    serverStartAt: new Date(serverStartAtMs),
                  },
                });

                await prisma.pvpParticipant.createMany({
                  data: [{ matchId: match.id, userId: human.userId, slot: 0 }],
                  skipDuplicates: true,
                });

                sendToUser(wss, human.userId, "MATCH_FOUND", {
                  matchId: match.id,
                  textSnapshot: local.textSnapshot,
                  serverStartAt: new Date(serverStartAtMs).toISOString(),
                  players: Array.from(local.participants.values()).map((p) => ({
                    userId: p.userId,
                    username: p.username,
                    avatar: p.avatar,
                    slot: p.slot,
                  })),
                });

                await startAiSimulation({
                  prisma,
                  wss,
                  state,
                  eventBus,
                  matchId: match.id,
                  humanId: human.userId,
                  aiUserId,
                  snapshotIntervalMs: MATCH_SNAPSHOT_INTERVAL_MS,
                });
              })().catch((e) => {
                const message = e instanceof Error ? e.message : "AI fallback failed";
                sendToUser(wss, userId, "ERROR", { message });
                sendToUser(wss, userId, "QUEUE_STATUS", { status: "IDLE" });
              });
            }, AI_QUEUE_TIMEOUT_MS);
            state.queueTimeouts.set(ws.user!.userId, timeout);
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
          gatewayLogDebug("Match join requested", {
            userId: ws.user.userId,
            matchId: msg.payload.matchId,
          });

          const participantRow = await prisma.pvpParticipant.findUnique({
            where: {
              matchId_userId: {
                matchId: msg.payload.matchId,
                userId: ws.user.userId,
              },
            },
            select: {
              slot: true,
              match: {
                select: {
                  id: true,
                  status: true,
                  textSnapshot: true,
                  serverStartAt: true,
                },
              },
            },
          });

          const matchJoinAccess = canJoinPvpMatchSocket({
            status: participantRow?.match.status ?? "FINISHED",
            participantExists: Boolean(participantRow),
            userId: ws.user.userId,
          });

          if (!matchJoinAccess.allowed) {
            gatewayLogWarn("Blocked invalid match join", {
              userId: ws.user.userId,
              matchId: msg.payload.matchId,
              reason: matchJoinAccess.reason,
            });
            send(ws, "ERROR", {
              message: matchJoinAccess.reason === "not_participant" ? "Not a participant" : "Match can no longer be joined",
            });
            return;
          }

          ws.matchId = msg.payload.matchId;
          claimMatchSession(msg.payload.matchId, ws.user.userId, ws);
          clearDisconnectForfeitTimer(msg.payload.matchId, ws.user.userId);
          const match = state.matches.get(msg.payload.matchId);
          if (!match) {
            const db = participantRow?.match;
            if (!db) {
              send(ws, "ERROR", { message: "Match not found" });
              return;
            }

            if (isTerminalPvpMatchStatus(db.status)) {
              send(ws, "ERROR", { message: "Match can no longer be joined" });
              return;
            }

            // Create a minimal local state from DB if missing
            const lifecycleState = matchStateFromDbStatus(db.status);
            state.matches.set(db.id, {
              matchId: db.id,
              roomCode: null,
              state: lifecycleState,
              stateChangedAt: Date.now(),
              revision: 1,
              lastSnapshotBroadcastAtMs: 0,
              status: matchStateToLegacyStatus(lifecycleState),
              textSnapshot: db.textSnapshot,
              serverStartAtMs: db.serverStartAt ? db.serverStartAt.getTime() : Date.now() + 3000,
              participants: new Map(),
              endedReason: null,
              forfeitedUserId: null,
            });
          }

          const effective = state.matches.get(msg.payload.matchId)!;
          const effectiveAccess = canJoinPvpMatchSocket({
            status: effective.status,
            participantExists: Boolean(participantRow),
            userId: ws.user.userId,
            forfeitedUserId: effective.forfeitedUserId,
            endedReason: effective.endedReason,
          });
          if (!effectiveAccess.allowed) {
            send(ws, "ERROR", {
              message: effectiveAccess.reason === "disconnect_forfeit" ? "Reconnect is not allowed after disconnect forfeit" : "Match can no longer be joined",
            });
            return;
          }
          const p = effective.participants.get(ws.user.userId);
          if (!p) {
            if (!participantRow) {
              send(ws, "ERROR", { message: "Not a participant" });
              return;
            }

            effective.participants.set(ws.user.userId, {
              userId: ws.user.userId,
              username: ws.user.username,
              avatar: ws.user.avatar,
              slot: participantRow.slot,
              input: "",
              seq: 0,
              errors: 0,
              wpm: 0,
              accuracy: 100,
              finishedAt: null,
            });
          }

          await storeIdempotencyHit({
            redis,
            store: idempotencyStore,
            key: idempotency?.key,
            messageType: msg.type,
            value: {
              response: {
                type: "MATCH_STATE",
                payload: buildMatchStatePayload(effective),
              },
            },
          });
          send(ws, "MATCH_STATE", buildMatchStatePayload(effective));

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
            await finalizeMatchByDisconnectForfeit({
              prisma,
              wss,
              state,
              eventBus,
              matchId: match.matchId,
              forfeitedUserId: ws.user.userId,
            });
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

          participant.input = next.slice(0, match.textSnapshot.length);
          participant.seq = msg.payload.seq;
          participant.errors = countErrors(match.textSnapshot, participant.input);
          participant.accuracy = computeAccuracy(match.textSnapshot, participant.input);
          participant.wpm = computeWpm(match.textSnapshot, participant.input, match.serverStartAtMs, nowMs);
          observeGatewayHistogram("pvp_input_update_chars", participant.input.length, [8, 16, 32, 64, 128, 256, 512, 1024]);

          if (participant.input.length >= match.textSnapshot.length && participant.finishedAt === null) {
            participant.finishedAt = nowMs;
          }

          // Broadcast progress
          bumpMatchRevision(match);
          broadcastMatch(wss, match.matchId, "PROGRESS", buildProgressPayload(match, participant, nowMs));
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

            const serverStartAtMs = Date.now() + 3500;
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
            });

            await prisma.pvpMatch.update({
              where: { id: matchRow.id },
              data: {
                status: "COUNTDOWN",
                textSnapshot: local.textSnapshot,
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
              serverStartAt: new Date(serverStartAtMs).toISOString(),
              players: Array.from(local.participants.values()).map((p) => ({
                userId: p.userId,
                username: p.username,
                avatar: p.avatar,
                slot: p.slot,
              })),
            });

            await startAiSimulation({
              prisma,
              wss,
              state,
              eventBus,
              matchId: matchRow.id,
              humanId: meId,
              aiUserId,
              snapshotIntervalMs: MATCH_SNAPSHOT_INTERVAL_MS,
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
            select: { id: true, code: true, status: true, maxPlayers: true, expiresAt: true },
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

          if (members.length >= room.maxPlayers) {
            send(ws, "ERROR", { message: "Room full" });
            return;
          }

          const used = new Set(members.map((m) => m.colorSlot));
          let slot = 0;
          while (used.has(slot) && slot < room.maxPlayers) slot += 1;
          if (slot >= room.maxPlayers) slot = Math.min(room.maxPlayers - 1, 5);

          await prisma.pvpRoomMember.upsert({
            where: { roomId_userId: { roomId: room.id, userId: ws.user.userId } },
            update: { leftAt: null, readyAt: null },
            create: { roomId: room.id, userId: ws.user.userId, colorSlot: slot },
          });

          const updated = await prisma.pvpRoomMember.findMany({
            where: { roomId: room.id, leftAt: null },
            orderBy: { joinedAt: "asc" },
            select: {
              userId: true,
              colorSlot: true,
              readyAt: true,
              joinedAt: true,
              user: { select: { username: true, profile: { select: { avatar: true } } } },
            },
          });

          broadcastRoom(wss, code, "ROOM_STATE", {
            room: {
              code,
              status: room.status,
              maxPlayers: room.maxPlayers,
              members: updated.map((m) => ({
                userId: m.userId,
                username: sanitizeDisplayName(m.user.username, 32) || "user",
                avatar: sanitizeAvatarUrl(m.user.profile?.avatar ?? null),
                slot: m.colorSlot,
                ready: !!m.readyAt,
              })),
            },
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
            select: { id: true, code: true, status: true, maxPlayers: true },
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

          const members = await prisma.pvpRoomMember.findMany({
            where: { roomId: room.id, leftAt: null },
            orderBy: { joinedAt: "asc" },
            select: {
              userId: true,
              colorSlot: true,
              readyAt: true,
              user: { select: { username: true, profile: { select: { avatar: true } } } },
            },
          });

          broadcastRoom(wss, code, "ROOM_STATE", {
            room: {
              code,
              status: room.status,
              maxPlayers: room.maxPlayers,
              members: members.map((m) => ({
                userId: m.userId,
                username: sanitizeDisplayName(m.user.username, 32) || "user",
                avatar: sanitizeAvatarUrl(m.user.profile?.avatar ?? null),
                slot: m.colorSlot,
                ready: !!m.readyAt,
              })),
            },
          });

          await storeIdempotencyHit({
            redis,
            store: idempotencyStore,
            key: idempotency?.key,
            messageType: msg.type,
            value: { response: null },
          });

          const active = members;
          const allReady = active.length >= 2 && active.every((m) => !!m.readyAt);
          if (!allReady) return;

          // Start match
          const serverStartAtMs = Date.now() + 5000;
          const match = await prisma.pvpMatch.create({
            data: {
              status: "COUNTDOWN",
              roomId: room.id,
              textSnapshot: "placeholder",
              serverStartAt: new Date(serverStartAtMs),
            },
            select: { id: true },
          });

          const local = state.createLocalMatch({
            matchId: match.id,
            roomCode: code,
            users: active.map((m) => ({
              userId: m.userId,
              username: m.user.username,
              avatar: m.user.profile?.avatar ?? null,
              pvpRating: 1500,
              pvpDeviation: 350,
              slot: m.colorSlot,
            })),
            serverStartAtMs,
          });
          eventBus.emit("match:countdown", {
            matchId: match.id,
            from: "lobby",
            to: "countdown",
            roomCode: code,
            atMs: local.stateChangedAt,
          });

          await prisma.pvpMatch.update({
            where: { id: match.id },
            data: { textSnapshot: local.textSnapshot },
          });

          await prisma.pvpParticipant.createMany({
            data: active.map((m) => ({
              matchId: match.id,
              userId: m.userId,
              slot: m.colorSlot,
            })),
            skipDuplicates: true,
          });

          await prisma.pvpRoom.update({
            where: { id: room.id },
            data: { status: "IN_MATCH" },
          });

          broadcastRoom(wss, code, "MATCH_FOUND", {
            matchId: match.id,
            textSnapshot: local.textSnapshot,
            serverStartAt: new Date(serverStartAtMs).toISOString(),
            players: Array.from(local.participants.values()).map((p) => ({
              userId: p.userId,
              username: p.username,
              avatar: p.avatar,
              slot: p.slot,
            })),
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

      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        gatewayLogError("Websocket message handler failed", e, {
          userId: ws.user?.userId,
          ip: ws.ip ?? "unknown",
          messageType: parsedMessage.success ? parsedMessage.data.type : "unknown",
        });
        send(ws, "ERROR", { message });
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
      if (ws.user) {
        state.removeFromQueue(ws.user.userId);
        state.clearQueueTimeout(ws.user.userId);
        void queueLeave(ws.user.userId);
        releaseMatchSession(ws);

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
              matchStatus: activeMatch.status,
            })
          ) {
            scheduleDisconnectForfeit(activeMatch.matchId, ws.user.userId);
          }
        }
      }

      if (ws.user && ws.roomCode) {
        const code = ws.roomCode;
        void prisma.pvpRoom
          .findUnique({ where: { code }, select: { id: true } })
          .then((room) => {
            if (!room) return;
            return prisma.pvpRoomMember.update({
              where: { roomId_userId: { roomId: room.id, userId: ws.user!.userId } },
              data: { leftAt: new Date() },
            });
          })
          .catch(() => {
            // ignore
          });
      }
    });
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
