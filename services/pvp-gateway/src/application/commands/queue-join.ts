/**
 * @module application/commands/queue-join
 * Handles QUEUE_JOIN — ranked matchmaking entry point.
 *
 * Three paths:
 *  1. Dev shortcut: TEST_FORCE_BOT_MATCH → immediate AI match.
 *  2. Redis-backed queue: try to match immediately, otherwise schedule
 *     an AI-fallback timer.
 *  3. Local in-memory queue: same shape as Redis path but lockless.
 */

import crypto from "crypto";

import { enqueueOrMatchInMemory } from "../../in-memory-queue";
import { recordQueueMatchMetrics } from "../../matchmaking/metrics";
import { startAiSimulationAdaptive } from "../../ai-simulation";
import { incrementGatewayMetric } from "../../metrics";
import { storeIdempotencyHit } from "../match-helpers";
import { send, sendToUser, getAuthedSocketsForUser } from "../../presentation/ws-sender";
import { finalizeMatchIfComplete } from "../finalize-match";
import { maybeBroadcastMatchSnapshot } from "../match-helpers";
import { PVP_ERROR_CODES } from "../../../../../src/features/pvp/shared/error-codes";
import { RANKED_MATCH_START_DELAY_MS } from "../../shared/config";
import { gatewayLogDebug, gatewayLogInfo, gatewayLogWarn, gatewayLogError } from "../../shared/logger";
import { toClientErrorPayload } from "../../shared/errors";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { LocalMatch } from "../../shared/types";
import type { loadIdempotencyHit } from "../match-helpers";

export async function handleQueueJoin(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "QUEUE_JOIN" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  const requestId = "requestId" in msg ? msg.requestId : undefined;
  const queueLogContext = {
    userId: ws.user!.userId,
    requestId,
    connectionId: ws.connectionId,
    queueMode: deps.redisBus ? "redis" : "local",
  };

  if (!deps.gatewayHealthController?.canAcceptTraffic()) {
    gatewayLogWarn("Rejected ranked queue join because the gateway is draining", queueLogContext);
    send(ws, "ERROR", {
      code: PVP_ERROR_CODES.QUEUE_GATEWAY_DRAINING,
      message: "Gateway is draining",
      retryable: true,
      details: { requestId, phase: "queue_join_precondition" },
    }, deps);
    send(ws, "QUEUE_STATUS", { status: "IDLE" }, deps);
    return;
  }

  gatewayLogInfo("Ranked queue join requested", { ...queueLogContext, useRedis: Boolean(deps.redisBus) });

  // ── Dev shortcut: immediate AI match ─────────────────────────────────────
  if (deps.testForceBotMatch) {
    const me = await deps.loadConnectionUser(ws.user!.userId);
    ws.user = { ...me, tokenVersion: ws.user!.tokenVersion, validAfter: ws.user!.validAfter, issuedAt: ws.user!.issuedAt };
    const aiUserId = process.env.PVP_TEST_AI_USER_ID ?? "ai:test-bot";
    const aiUsername = process.env.PVP_TEST_AI_USERNAME ?? "Kai";

    deps.state.removeFromQueue(me.userId);
    deps.state.clearQueueTimeout(me.userId);

    const created = await deps.createRanked1v1Match({
      users: [
        { ...me, slot: 0 },
        { userId: aiUserId, username: aiUsername, avatar: null, pvpRating: me.pvpRating, pvpDeviation: 180, slot: 1 },
      ],
      persistUserIds: [me.userId],
      startDelayMs: RANKED_MATCH_START_DELAY_MS,
    });

    await startAiSimulationAdaptive({
      db: deps.db,
      wss: deps.wss,
      matchCache: deps.matchCache,
      matchRepository: deps.matchRepository,
      matchId: created.matchId,
      humanId: me.userId,
      aiUserId,
      snapshotIntervalMs: deps.matchSnapshotIntervalMs,
      state: deps.state,
      forceFinishHumanAfterMs: parseInt(process.env.PVP_FORCE_BOT_FINISH_HUMAN_AFTER_MS ?? "10000", 10),
      onFinalizeMatchIfComplete: (matchId) => finalizeMatchIfComplete({ matchId, deps }),
      onBroadcastMatchSnapshot: (matchId, nowMs, intervalMs) => {
        const liveMatch = deps.state.matches.get(matchId) as LocalMatch | undefined;
        if (!liveMatch) return false;
        return maybeBroadcastMatchSnapshot(liveMatch, nowMs, intervalMs, deps);
      },
    });

    await storeIdempotencyHit({
      redis: deps.redisBus?.redis ?? null,
      store: deps.idempotencyStore,
      key: idempotency?.key,
      messageType: msg.type,
      value: { response: { type: "MATCH_FOUND", payload: created.payload } },
    });
    return;
  }

  const me = await deps.loadConnectionUser(ws.user!.userId);
  ws.user = { ...me, tokenVersion: ws.user!.tokenVersion, validAfter: ws.user!.validAfter, issuedAt: ws.user!.issuedAt };
  await deps.markOnline(me.userId);

  // ── Redis-backed queue ────────────────────────────────────────────────────
  if (deps.redisBus) {
    const existingQueued = await deps.queueAdapter.readMeta(me.userId);
    if (existingQueued) {
      gatewayLogInfo("Resumed existing ranked queue search", {
        ...queueLogContext,
        queuedForMs: Math.max(0, Date.now() - existingQueued.joinedAtMs),
        bucketKey: existingQueued.bucketKey,
      });
      await storeIdempotencyHit({
        redis: deps.redisBus.redis,
        store: deps.idempotencyStore,
        key: idempotency?.key,
        messageType: msg.type,
        value: { response: { type: "QUEUE_STATUS", payload: { status: "SEARCHING" } } },
      });
      send(ws, "QUEUE_STATUS", { status: "SEARCHING" }, deps);
      return;
    }

    deps.state.clearQueueTimeout(me.userId);
    const queuedMeta = await deps.queueAdapter.join(me);
    gatewayLogDebug("Ranked queue join enqueued", {
      ...queueLogContext,
      bucketKey: queuedMeta?.bucketKey,
      rating: me.pvpRating,
    });

    const queuedMatch = await deps.queueAdapter.tryMatch(me);
    if (queuedMatch) {
      const other = await deps.loadConnectionUser(queuedMatch.otherId);
      const otherWaitMs = queuedMatch.other ? Math.max(0, Date.now() - queuedMatch.other.joinedAtMs) : 0;

      await recordQueueMatchMetrics(deps.redisBus.redis, {
        queueWaitMs: [Math.max(0, Date.now() - queuedMatch.me.joinedAtMs), otherWaitMs],
        ratingDelta: Math.abs(other.pvpRating - me.pvpRating),
      });
      deps.gatewayMetrics?.observeMatchStartLatency(
        "ranked",
        Math.max(Math.max(0, Date.now() - queuedMatch.me.joinedAtMs), otherWaitMs) / 1000,
      );
      gatewayLogInfo("Ranked queue matched", {
        userIds: [other.userId, me.userId],
        ratingDelta: Math.abs(other.pvpRating - me.pvpRating),
        queueWaitMs: [Math.max(0, Date.now() - queuedMatch.me.joinedAtMs), otherWaitMs],
        preference: me.matchmakingPreference,
      });

      const created = await deps.createRanked1v1Match({
        users: [{ ...other, slot: 0 }, { ...me, slot: 1 }],
        persistUserIds: [other.userId, me.userId],
        startDelayMs: RANKED_MATCH_START_DELAY_MS,
      });
      await storeIdempotencyHit({
        redis: deps.redisBus.redis,
        store: deps.idempotencyStore,
        key: idempotency?.key,
        messageType: msg.type,
        value: { response: { type: "MATCH_FOUND", payload: created.payload } },
      });
      return;
    }

    await storeIdempotencyHit({
      redis: deps.redisBus.redis,
      store: deps.idempotencyStore,
      key: idempotency?.key,
      messageType: msg.type,
      value: { response: { type: "QUEUE_STATUS", payload: { status: "SEARCHING" } } },
    });

    // AI fallback timer (Redis path)
    const timeout = setTimeout(() => {
      const userId = ws.user?.userId;
      if (!userId) return;

      const sockets = getAuthedSocketsForUser(userId, deps);
      if (sockets.length === 0) {
        gatewayLogInfo("Removed ranked queue user after disconnect before AI fallback", queueLogContext);
        void deps.queueAdapter.leave(userId);
        deps.state.clearQueueTimeout(userId);
        return;
      }

      void (async () => {
        gatewayLogInfo("Ranked queue AI fallback timer fired", {
          ...queueLogContext,
          timeoutMs: deps.aiQueueTimeoutMs,
        });
        const removed = await deps.queueAdapter.leave(userId);
        if (removed === 0) {
          gatewayLogDebug("Skipped ranked queue AI fallback because the user was no longer queued", queueLogContext);
          return;
        }
        deps.state.clearQueueTimeout(userId);
        const human = await deps.loadConnectionUser(userId);
        const aiUserId = `ai:${crypto.randomUUID()}`;
        const created = await deps.createRanked1v1Match({
          users: [
            { ...human, slot: 0 },
            { userId: aiUserId, username: "Kai", avatar: null, pvpRating: human.pvpRating, pvpDeviation: 180, slot: 1 },
          ],
          persistUserIds: [human.userId],
          startDelayMs: RANKED_MATCH_START_DELAY_MS,
        });
        gatewayLogInfo("Created ranked AI fallback match", {
          ...queueLogContext,
          matchId: created.matchId,
          queuedForMs: queuedMeta ? Math.max(0, Date.now() - queuedMeta.joinedAtMs) : undefined,
        });
        incrementGatewayMetric("pvp_queue_ai_fallback_total", { queue_mode: "redis" });

        await startAiSimulationAdaptive({
          db: deps.db,
          wss: deps.wss,
          matchCache: deps.matchCache,
          matchRepository: deps.matchRepository,
          matchId: created.matchId,
          humanId: human.userId,
          aiUserId,
          snapshotIntervalMs: deps.matchSnapshotIntervalMs,
          state: deps.state,
          onFinalizeMatchIfComplete: (matchId) => finalizeMatchIfComplete({ matchId, deps }),
          onBroadcastMatchSnapshot: (matchId, nowMs, intervalMs) => {
            const liveMatch = deps.state.matches.get(matchId) as LocalMatch | undefined;
            if (!liveMatch) return false;
            return maybeBroadcastMatchSnapshot(liveMatch, nowMs, intervalMs, deps);
          },
        });
      })().catch((e: unknown) => {
        const payload = toClientErrorPayload(e, {
          code: PVP_ERROR_CODES.QUEUE_AI_FALLBACK_FAILED,
          message: "AI fallback failed",
          retryable: true,
          details: { requestId, phase: "queue_ai_fallback" },
        });
        gatewayLogError("Ranked queue AI fallback failed", e, queueLogContext);
        sendToUser(userId, "ERROR", payload, deps);
        sendToUser(userId, "QUEUE_STATUS", { status: "IDLE" }, deps);
      });
    }, deps.aiQueueTimeoutMs);

    deps.state.queueTimeouts.set(me.userId, timeout);
    gatewayLogDebug("Scheduled ranked queue AI fallback timer", { ...queueLogContext, timeoutMs: deps.aiQueueTimeoutMs });
    send(ws, "QUEUE_STATUS", { status: "SEARCHING" }, deps);
    return;
  }

  // ── Local in-memory queue ─────────────────────────────────────────────────
  let localQueueResponseType: string | null = null;
  let localQueueResponsePayload: unknown = null;
  let shouldSendLocalQueueResponse = false;

  await deps.localQueueLock.runExclusive(async () => {
    const existingEntry = deps.state.queue.find((entry) => entry.user.userId === ws.user!.userId);
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

    deps.state.removeFromQueue(ws.user!.userId);
    deps.state.clearQueueTimeout(ws.user!.userId);
    const queueResult = enqueueOrMatchInMemory({
      queue: deps.state.queue,
      user: me,
      ratingRange: deps.queueRatingRange,
      requestId,
      connectionId: ws.connectionId,
    });

    if (queueResult.kind === "matched") {
      const [other, currentUser] = queueResult.users;
      deps.state.clearQueueTimeout(currentUser.userId);
      deps.state.clearQueueTimeout(other.userId);

      gatewayLogInfo("Ranked queue matched (local)", {
        userIds: [other.userId, currentUser.userId],
        ratingDelta: Math.abs(other.pvpRating - currentUser.pvpRating),
        queueWaitMs: queueResult.queueWaitMs,
        preference: currentUser.matchmakingPreference,
      });
      deps.gatewayMetrics?.observeMatchStartLatency(
        "ranked",
        Math.max(...queueResult.queueWaitMs.map((v) => Math.max(0, v))) / 1000,
      );

      const created = await deps.createRanked1v1Match({
        users: [{ ...other, slot: 0 }, { ...currentUser, slot: 1 }],
        persistUserIds: [other.userId, currentUser.userId],
        startDelayMs: RANKED_MATCH_START_DELAY_MS,
      });
      await storeIdempotencyHit({
        redis: null,
        store: deps.idempotencyStore,
        key: idempotency?.key,
        messageType: msg.type,
        value: { response: { type: "MATCH_FOUND", payload: created.payload } },
      });
      localQueueResponseType = "MATCH_FOUND";
      localQueueResponsePayload = created.payload;
      return;
    }

    // AI fallback timer (local path)
    const timeout = setTimeout(() => {
      const userId = ws.user?.userId;
      if (!userId) return;
      const stillQueued = deps.state.queue.find(
        (e) => e.user.userId === userId && e.requestId === requestId && e.connectionId === ws.connectionId,
      );
      if (!stillQueued) return;

      const sockets = getAuthedSocketsForUser(userId, deps);
      if (sockets.length === 0) {
        deps.state.removeFromQueue(userId);
        deps.state.clearQueueTimeout(userId);
        return;
      }

      deps.state.removeFromQueue(userId);
      deps.state.clearQueueTimeout(userId);

      void (async () => {
        gatewayLogInfo("Local ranked queue AI fallback timer fired", {
          ...queueLogContext,
          timeoutMs: deps.aiQueueTimeoutMs,
        });
        const human = stillQueued.user;
        const aiUserId = `ai:${crypto.randomUUID()}`;
        const created = await deps.createRanked1v1Match({
          users: [
            { userId: human.userId, username: human.username, avatar: human.avatar, pvpRating: human.pvpRating, pvpDeviation: human.pvpDeviation, slot: 0 },
            { userId: aiUserId, username: "Kai", avatar: null, pvpRating: human.pvpRating, pvpDeviation: 180, slot: 1 },
          ],
          persistUserIds: [human.userId],
          startDelayMs: RANKED_MATCH_START_DELAY_MS,
        });
        gatewayLogInfo("Created local ranked AI fallback match", {
          ...queueLogContext,
          matchId: created.matchId,
          queuedForMs: Math.max(0, Date.now() - stillQueued.joinedAtMs),
        });
        incrementGatewayMetric("pvp_queue_ai_fallback_total", { queue_mode: "local" });

        await startAiSimulationAdaptive({
          db: deps.db,
          wss: deps.wss,
          matchCache: deps.matchCache,
          matchRepository: deps.matchRepository,
          matchId: created.matchId,
          humanId: human.userId,
          aiUserId,
          snapshotIntervalMs: deps.matchSnapshotIntervalMs,
          state: deps.state,
          onFinalizeMatchIfComplete: (matchId) => finalizeMatchIfComplete({ matchId, deps }),
          onBroadcastMatchSnapshot: (matchId, nowMs, intervalMs) => {
            const liveMatch = deps.state.matches.get(matchId) as LocalMatch | undefined;
            if (!liveMatch) return false;
            return maybeBroadcastMatchSnapshot(liveMatch, nowMs, intervalMs, deps);
          },
        });
      })().catch((e: unknown) => {
        const payload = toClientErrorPayload(e, {
          code: PVP_ERROR_CODES.QUEUE_AI_FALLBACK_FAILED,
          message: "AI fallback failed",
          retryable: true,
          details: { requestId, phase: "queue_ai_fallback" },
        });
        gatewayLogError("Local ranked queue AI fallback failed", e, queueLogContext);
        sendToUser(userId, "ERROR", payload, deps);
        sendToUser(userId, "QUEUE_STATUS", { status: "IDLE" }, deps);
      });
    }, deps.aiQueueTimeoutMs);

    deps.state.queueTimeouts.set(ws.user!.userId, timeout);
    gatewayLogDebug("Scheduled local ranked queue AI fallback timer", { ...queueLogContext, timeoutMs: deps.aiQueueTimeoutMs });
    localQueueResponseType = "QUEUE_STATUS";
    localQueueResponsePayload = { status: "SEARCHING" };
    shouldSendLocalQueueResponse = true;
  });

  if (localQueueResponseType) {
    await storeIdempotencyHit({
      redis: null,
      store: deps.idempotencyStore,
      key: idempotency?.key,
      messageType: msg.type,
      value: { response: { type: localQueueResponseType, payload: localQueueResponsePayload } },
    });
  }
  if (localQueueResponseType && shouldSendLocalQueueResponse) {
    send(ws, localQueueResponseType as Parameters<typeof send>[1], localQueueResponsePayload, deps);
  }
}
