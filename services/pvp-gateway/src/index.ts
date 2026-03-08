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
import { incrementGatewayMetric } from "./metrics";
import { sanitizeAvatarUrl, sanitizeDisplayName, sanitizeRoomCode, sanitizeUserAgent } from "../../../src/lib/sanitize";

const IS_PROD = process.env.NODE_ENV === "production";
const INSTANCE_ID = process.env.PVP_INSTANCE_ID ?? crypto.randomUUID();

let redisBus: RedisBus | null = null;

type WsConn = WebSocket & {
  user?: AuthedUser;
  matchId?: string;
  roomCode?: string;
  ip?: string;
  rl?: { general: TokenBucket; input: TokenBucket; roomAction: TokenBucket };
  rawMsgStrikes?: number;
  presenceInterval?: NodeJS.Timeout | null;
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
  const healthHandler: http.RequestListener = (_, res) => {
    res.writeHead(200);
    res.end("pvp-gateway ok");
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

function send(ws: WsConn, type: ServerMessage["type"], payload: unknown) {
  try {
    ws.send(toJson({ type, payload }));
  } catch {
    // ignore
  }
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

async function finalizeMatchIfComplete(params: {
  prisma: PrismaClient;
  wss: WebSocketServer;
  state: InMemoryState;
  matchId: string;
}) {
  const match = params.state.matches.get(params.matchId);
  if (!match) return;
  if (match.status === "FINISHED") return;

  const all = Array.from(match.participants.values());
  const finished = all.filter((p0) => p0.finishedAt != null);
  if (finished.length < Math.max(2, all.length)) return;

  match.status = "FINISHED";
  params.state.clearAiInterval(match.matchId);

  await params.prisma.pvpMatch.update({
    where: { id: match.matchId },
    data: {
      status: "FINISHED",
      startedAt: new Date(match.serverStartAtMs),
      endedAt: new Date(),
    },
  });

  const placements = [...all]
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

  // Rating changes
  let ratingChanges: Array<{ userId: string; before: number; after: number; delta: number }> = [];

  const ai = placements.find((p) => isAiUserId(p.userId)) ?? null;
  const humans = placements.filter((p) => !isAiUserId(p.userId));

  // Only ranked when roomCode is null
  if (match.roomCode === null && placements.length === 2 && humans.length === 1 && ai) {
    const humanId = humans[0]!.userId;
    const humanWon = placements[0]!.userId === humanId;

    const humanRow = await params.prisma.pvpRating.upsert({
      where: { userId: humanId },
      update: {},
      create: { userId: humanId },
    });

    // Derive AI rating from its effective WPM.
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
  } else if (match.roomCode === null && placements.length === 2 && humans.length === 2) {
    // Human vs human (existing logic)
    const winnerId = placements[0]!.userId;
    const loserId = placements[1]!.userId;

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
    placements,
    ratingChanges,
  });
}

async function startAiSimulation(params: {
  prisma: PrismaClient;
  wss: WebSocketServer;
  state: InMemoryState;
  matchId: string;
  humanId: string;
  aiUserId: string;
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
    if (current.status === "COUNTDOWN") current.status = "RUNNING";
    if (current.status === "FINISHED") {
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
        if (mm.status === "FINISHED") return;
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
          .then(() => finalizeMatchIfComplete({ prisma: params.prisma, wss: params.wss, state: params.state, matchId: mm.matchId }))
          .catch(() => {
            // ignore
          });
      }, forceFinishDelayMs);
    }

    // Broadcast AI progress
    broadcastMatch(params.wss, current.matchId, "PROGRESS", {
      matchId: current.matchId,
      userId: aiNow.userId,
      caretIndex: aiNow.input.length,
      wpm: aiNow.wpm,
      accuracy: aiNow.accuracy,
      errors: aiNow.errors,
      serverNowMs: nowMs,
    });

    if (aiNow.finishedAt != null) {
      await finalizeMatchIfComplete({ prisma: params.prisma, wss: params.wss, state: params.state, matchId: current.matchId });
    }
  }, tickMs);

  params.state.aiIntervals.set(params.matchId, interval);
}

async function main() {
  const PORT = envInt("PORT", 8787);
  const prisma = new PrismaClient();
  const state = new InMemoryState();

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
  const ROOM_ACTION_COOLDOWN_MS = envMs("PVP_ROOM_ACTION_COOLDOWN_MS", 2_000);
  const CONNECTION_SPIKE_ALERT_THRESHOLD = envInt("PVP_WS_CONNECTION_SPIKE_ALERT_THRESHOLD", 30);

  const wss = new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD_BYTES });
  const activeConnectionsByIp = new Map<string, number>();
  const connectionAttemptBuckets = new Map<string, TokenBucket>();
  const roomActionLastSeen = new Map<string, number>();

  const USE_REDIS = envBool("PVP_USE_REDIS", false);
  const REDIS_URL = process.env.PVP_REDIS_URL ?? process.env.REDIS_URL ?? null;

  if (USE_REDIS) {
    if (!REDIS_URL) throw new Error("PVP_USE_REDIS is enabled but PVP_REDIS_URL/REDIS_URL is missing");

    redisBus = await createRedisBus(REDIS_URL);
    await redisBus.psubscribe("pvp:user:*");
    await redisBus.psubscribe("pvp:match:*");
    await redisBus.psubscribe("pvp:room:*");

    redisBus.onMessage((channel, msg) => {
      if (channel.startsWith("pvp:user:")) {
        const userId = channel.slice("pvp:user:".length);
        for (const c of getAuthedSocketsForUser(wss, userId)) send(c, msg.type as any, msg.payload);
        return;
      }
      if (channel.startsWith("pvp:match:")) {
        const matchId = channel.slice("pvp:match:".length);
        wss.clients.forEach((client: WebSocket) => {
          const c = client as WsConn;
          if (c.matchId !== matchId) return;
          send(c, msg.type as any, msg.payload);
        });
        return;
      }
      if (channel.startsWith("pvp:room:")) {
        const roomCode = channel.slice("pvp:room:".length);
        wss.clients.forEach((client: WebSocket) => {
          const c = client as WsConn;
          if (c.roomCode !== roomCode) return;
          send(c, msg.type as any, msg.payload);
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

  wss.on("connection", (ws: WsConn, req: http.IncomingMessage) => {
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
          send(ws, "AUTH_REFRESH_OK", { expiresAt: Math.floor(Date.now() / 1000) + envInt("PVP_WS_TOKEN_TTL_SECONDS", 900) });
          return;
        }

        if (!ws.user) {
          send(ws, "ERROR", { message: "Unauthenticated" });
          return;
        }

        if (msg.type === "QUEUE_JOIN") {
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
              matchId: match.id,
              humanId: me.userId,
              aiUserId: bot.userId,
              persistSimUserToDb: true,
              forceFinishHumanAfterMs: 0,
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
                  matchId: match.id,
                  humanId: human.userId,
                  aiUserId,
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

          // Single-instance in-memory queue
          state.removeFromQueue(ws.user.userId);
          state.clearQueueTimeout(ws.user.userId);
          state.queue.push({ user: ws.user, joinedAtMs: Date.now() });

          // naive in-memory skill-based match
          const idx = state.queue.findIndex((e) => e.user.userId !== me.userId && Math.abs(e.user.pvpRating - me.pvpRating) <= 200);
          if (idx >= 0) {
            const other = state.queue[idx]!.user;
            state.removeFromQueue(me.userId);
            state.removeFromQueue(other.userId);
            state.clearQueueTimeout(me.userId);
            state.clearQueueTimeout(other.userId);

            await createRanked1v1Match({
              users: [
                { ...other, slot: 0 },
                { ...me, slot: 1 },
              ],
              persistUserIds: [other.userId, me.userId],
              startDelayMs: 4000,
            });
            return;
          }

          // Fallback: after a timeout, start a match vs AI.
          const timeout = setTimeout(() => {
            const userId = ws.user?.userId;
            if (!userId) return;

            // Still queued?
            const stillQueued = state.queue.find((e) => e.user.userId === userId);
            if (!stillQueued) return;

            // If there is no live socket, don't create a match.
            const sockets = getAuthedSocketsForUser(wss, userId);
            if (sockets.length === 0) {
              state.removeFromQueue(userId);
              state.clearQueueTimeout(userId);
              return;
            }

            // Remove from queue and start AI match.
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

              // Start AI simulation.
              await startAiSimulation({
                prisma,
                wss,
                state,
                matchId: match.id,
                humanId: human.userId,
                aiUserId,
              });
            })().catch((e) => {
              const message = e instanceof Error ? e.message : "AI fallback failed";
              sendToUser(wss, userId, "ERROR", { message });
              sendToUser(wss, userId, "QUEUE_STATUS", { status: "IDLE" });
            });
          }, AI_QUEUE_TIMEOUT_MS);
          state.queueTimeouts.set(ws.user.userId, timeout);

          send(ws, "QUEUE_STATUS", { status: "SEARCHING" });
          return;
        }

        if (msg.type === "QUEUE_LEAVE") {
          state.removeFromQueue(ws.user.userId);
          state.clearQueueTimeout(ws.user.userId);
          await queueLeave(ws.user.userId);
          send(ws, "QUEUE_STATUS", { status: "IDLE" });
          return;
        }

        if (msg.type === "MATCH_JOIN") {
          ws.matchId = msg.payload.matchId;
          const match = state.matches.get(msg.payload.matchId);
          if (!match) {
            // fallback: load from DB
            const db = await prisma.pvpMatch.findUnique({
              where: { id: msg.payload.matchId },
              select: { id: true, status: true, textSnapshot: true, serverStartAt: true },
            });
            if (!db) {
              send(ws, "ERROR", { message: "Match not found" });
              return;
            }

            // Create a minimal local state from DB if missing
            state.matches.set(db.id, {
              matchId: db.id,
              roomCode: null,
              status: db.status === "FINISHED" ? "FINISHED" : db.status === "RUNNING" ? "RUNNING" : "COUNTDOWN",
              textSnapshot: db.textSnapshot,
              serverStartAtMs: db.serverStartAt ? db.serverStartAt.getTime() : Date.now() + 3000,
              participants: new Map(),
            });
          }

          const effective = state.matches.get(msg.payload.matchId)!;
          const p = effective.participants.get(ws.user.userId);
          if (!p) {
            // Ensure participant exists in DB
            const isParticipant = await prisma.pvpParticipant.findUnique({
              where: {
                matchId_userId: {
                  matchId: msg.payload.matchId,
                  userId: ws.user.userId,
                },
              },
              select: { slot: true },
            });

            if (!isParticipant) {
              send(ws, "ERROR", { message: "Not a participant" });
              return;
            }

            effective.participants.set(ws.user.userId, {
              userId: ws.user.userId,
              username: ws.user.username,
              avatar: ws.user.avatar,
              slot: isParticipant.slot,
              input: "",
              seq: 0,
              errors: 0,
              wpm: 0,
              accuracy: 100,
              finishedAt: null,
            });
          }

          send(ws, "MATCH_STATE", {
            matchId: effective.matchId,
            roomCode: effective.roomCode,
            status: effective.status,
            textSnapshot: effective.textSnapshot,
            serverStartAt: new Date(effective.serverStartAtMs).toISOString(),
            players: Array.from(effective.participants.values()).map((pp) => ({
              userId: pp.userId,
              username: pp.username,
              avatar: pp.avatar,
              slot: pp.slot,
              caretIndex: pp.input.length,
            })),
          });

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

          if (match.status === "COUNTDOWN") match.status = "RUNNING";

          // Sequence check (monotonic)
          if (msg.payload.seq <= participant.seq) return;

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

          if (participant.input.length >= match.textSnapshot.length && participant.finishedAt === null) {
            participant.finishedAt = nowMs;
          }

          // Broadcast progress
          broadcastMatch(wss, match.matchId, "PROGRESS", {
            matchId: match.matchId,
            userId: participant.userId,
            caretIndex: participant.input.length,
            wpm: participant.wpm,
            accuracy: participant.accuracy,
            errors: participant.errors,
            serverNowMs: nowMs,
          });

          await finalizeMatchIfComplete({ prisma, wss, state, matchId: match.matchId });

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

          await finalizeMatchIfComplete({ prisma, wss, state, matchId: match.matchId });

          return;
        }

        if (msg.type === "REMATCH_REQUEST") {
          const match = state.matches.get(msg.payload.matchId);
          if (!match) {
            send(ws, "ERROR", { message: "Unknown match" });
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
              matchId: matchRow.id,
              humanId: meId,
              aiUserId,
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

            await createRanked1v1Match({
              users: [
                { ...aConn, slot: me.slot },
                { ...bConn, slot: other.slot },
              ],
              persistUserIds: [meId, other.userId],
              startDelayMs: 3500,
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

            await createRanked1v1Match({
              users: [
                { ...aConn, slot: me.slot },
                { ...bConn, slot: other.slot },
              ],
              persistUserIds: [meId, other.userId],
              startDelayMs: 3500,
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

          return;
        }

      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        send(ws, "ERROR", { message });
      }
    });

    ws.on("close", () => {
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
    console.log(`[pvp-gateway] listening on :${PORT}`);
  });
}

void main();
