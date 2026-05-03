/**
 * @module presentation/ws-connection
 *
 * Wires up the per-connection WebSocket lifecycle:
 *   - connection-level rate limiting & rejection checks
 *   - ping/pong heartbeat
 *   - message parsing + routing via ws-router
 *   - disconnect cleanup (queue, session, room, match forfeit)
 */

import type { IncomingMessage } from "http";
import type { WebSocketServer } from "ws";

import { WebSocket } from "ws";
import { eq, and } from "drizzle-orm";

import { pvpRooms, pvpRoomMembers } from "../../../../src/db/schema";
import { createTokenBucket, tryConsume, type TokenBucket } from "../rate-limit";
import { getClientIp, isSecureGatewayRequest, originAllowed } from "./http-server";
import { safeParseClientMessage } from "../protocol";
import { routeMessage } from "./ws-router";
import { send } from "./ws-sender";
import { buildRoomReconnectKey } from "../rooms/lifecycle";
import { transferRoomHostIfNeeded, broadcastRoomState, deleteRoomIfEmpty } from "../application/room-helpers";
import {
  shouldScheduleDisconnectForfeit,
  getDisconnectForfeitPolicy,
} from "../match-session-guards";
import { toClientErrorPayload, isAiUserId } from "../shared/errors";
import { gatewayLogDebug, gatewayLogWarn, gatewayLogError } from "../shared/logger";
import { incrementGatewayMetric } from "../metrics";
import { DEV_BYPASS_RATE_LIMIT } from "../shared/config";

import type { WsConn } from "./ws-conn";
import type { GatewayDeps } from "../application/deps";
import type { LocalMatch } from "../shared/types";

// =============================================================================
// TYPES
// =============================================================================

export interface WsServerOpts {
  /** Maximum WebSocket message payload in bytes (default: 16 KB). */
  maxPayloadBytes: number;
  /** Per-connection general message burst capacity. */
  maxMsgBurst: number;
  /** Per-connection general messages per second. */
  maxMsgPerSec: number;
  /** Per-connection INPUT_UPDATE burst capacity. */
  maxInputMsgBurst: number;
  /** Per-connection INPUT_UPDATE messages per second. */
  maxInputMsgPerSec: number;
  /** Max active connections per IP. */
  maxConnectionsPerIp: number;
  /** Max connection attempt burst per IP. */
  connectionAttemptsBurst: number;
  /** Max connection attempts per minute per IP. */
  connectionAttemptsPerMin: number;
  /** WebSocket ping interval in ms (0 to disable). */
  pingIntervalMs: number;
  /** Room-action cooldown token-bucket refill rate in ms. */
  roomActionCooldownMs: number;
  /** Number of new connections from one IP that triggers a spike alert. */
  connectionSpikeAlertThreshold: number;
  /** Global connection bucket refill per second (0 to disable). */
  globalConnPerSec: number;
  /** Global connection bucket burst capacity. */
  globalConnBurst: number;
  /** Grace period (ms) before a disconnect triggers a forfeit. */
  disconnectForfeitGraceMs: number;
  /** Grace period (ms) for room reconnect key TTL. */
  roomReconnectGraceMs: number;
}

export interface WsServerState {
  activeConnectionsByIp: Map<string, number>;
  connectionAttemptBuckets: Map<string, TokenBucket>;
  globalConnectionBucket: ReturnType<typeof createTokenBucket> | null;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

function findActiveMatchByUserId(deps: GatewayDeps, userId: string): LocalMatch | null {
  for (const match of deps.state.matches.values()) {
    if (!match.participants.has(userId)) continue;
    if (match.state === "finished" || match.state === "aborted") continue;
    return match as LocalMatch;
  }
  return null;
}

function getAuthedSocketsForUserId(wss: WebSocketServer, userId: string): WsConn[] {
  const sockets: WsConn[] = [];
  for (const client of wss.clients) {
    const socket = client as WsConn;
    if (socket.user?.userId === userId) sockets.push(socket);
  }
  return sockets;
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Attach the connection handler to `wss`. Call once during server startup.
 * After this, every accepted WS connection will be managed by this module.
 */
export function setupWssConnectionHandler(
  wss: WebSocketServer,
  deps: GatewayDeps,
  opts: WsServerOpts,
  connState: WsServerState,
): void {
  wss.on("connection", (ws: WsConn, req: IncomingMessage) => {
    ws.connectionId = crypto.randomUUID();

    // ----- Gateway readiness check ----------------------------------------
    if (!deps.gatewayHealthController?.canAcceptTraffic()) {
      deps.gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "gateway_not_ready" });
      gatewayLogWarn("Rejected websocket connection because gateway cannot accept traffic", {
        ip: ws.ip ?? getClientIp(req),
        ready: deps.gatewayHealthController?.isReady() ?? false,
        draining: deps.gatewayHealthController?.isDraining() ?? false,
        activeConnections: wss.clients.size,
      });
      ws.close(1013, "Gateway not ready");
      return;
    }

    // ----- Transport / origin checks --------------------------------------
    if (!isSecureGatewayRequest(req)) {
      deps.gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "insecure_transport" });
      ws.close(1008, "Secure websocket required");
      return;
    }
    if (!originAllowed(req.headers.origin)) {
      deps.gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "origin_not_allowed" });
      ws.close(1008, "Origin not allowed");
      return;
    }

    const ip = getClientIp(req);
    ws.ip = ip;

    // ----- Global connection rate limit -----------------------------------
    if (!DEV_BYPASS_RATE_LIMIT && connState.globalConnectionBucket && !tryConsume(connState.globalConnectionBucket, 1, Date.now())) {
      deps.gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "global_connection_rate_limit" });
      gatewayLogWarn("Rejected websocket connection by global connection rate limit", {
        ip,
        refillPerSec: opts.globalConnPerSec,
        burst: opts.globalConnBurst,
      });
      ws.close(1013, "Gateway busy");
      return;
    }

    // ----- Per-IP connection-attempt rate limit ---------------------------
    let attemptBucket = connState.connectionAttemptBuckets.get(ip);
    if (!attemptBucket) {
      attemptBucket = createTokenBucket({
        capacity: opts.connectionAttemptsBurst,
        refillPerSec: opts.connectionAttemptsPerMin / 60,
        nowMs: Date.now(),
      });
      connState.connectionAttemptBuckets.set(ip, attemptBucket);
    }
    if (!DEV_BYPASS_RATE_LIMIT && !tryConsume(attemptBucket, 1, Date.now())) {
      deps.gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "connection_attempt_rate_limit", ip });
      gatewayLogWarn("Rejected websocket connection by per-IP connection attempt rate limit", {
        ip,
        attemptsPerMin: opts.connectionAttemptsPerMin,
        burst: opts.connectionAttemptsBurst,
      });
      ws.close(1013, "Too many connection attempts");
      return;
    }

    // ----- Per-IP concurrent connection cap ------------------------------
    const activeForIp = connState.activeConnectionsByIp.get(ip) ?? 0;
    if (!DEV_BYPASS_RATE_LIMIT && activeForIp >= opts.maxConnectionsPerIp) {
      deps.gatewayMetrics?.incrementWsHandshake("rejected");
      incrementGatewayMetric("ws_connection_rejected", { reason: "connection_cap", ip });
      gatewayLogWarn("Rejected websocket connection by per-IP active connection cap", {
        ip,
        activeForIp,
        maxConnectionsPerIp: opts.maxConnectionsPerIp,
      });
      ws.close(1013, "Too many active connections");
      return;
    }
    connState.activeConnectionsByIp.set(ip, activeForIp + 1);
    deps.gatewayMetrics?.setConnectionsActive(wss.clients.size);

    const nextSpikeCount = incrementGatewayMetric("ws_connection_opened", { ip });
    if (nextSpikeCount >= opts.connectionSpikeAlertThreshold) {
      console.warn(`[pvp-gateway] abnormal connection spike detected for ${ip}: ${nextSpikeCount}`);
    }

    // ----- Per-connection rate-limit buckets ------------------------------
    const connectedAtMs = Date.now();
    ws.rawMsgStrikes = 0;
    ws.rl = {
      general: createTokenBucket({ capacity: opts.maxMsgBurst, refillPerSec: opts.maxMsgPerSec, nowMs: connectedAtMs }),
      input: createTokenBucket({ capacity: opts.maxInputMsgBurst, refillPerSec: opts.maxInputMsgPerSec, nowMs: connectedAtMs }),
      roomAction: createTokenBucket({ capacity: 1, refillPerSec: 1000 / opts.roomActionCooldownMs, nowMs: connectedAtMs }),
    };

    // ----- Ping / pong heartbeat -----------------------------------------
    const pingInterval =
      opts.pingIntervalMs > 0
        ? setInterval(() => {
            try {
              if (ws.readyState === WebSocket.OPEN) ws.ping();
            } catch {
              // ignore
            }
          }, opts.pingIntervalMs)
        : null;

    send(ws, "QUEUE_STATUS", { status: "CONNECTED" }, deps);
    gatewayLogDebug("Incoming websocket connection", {
      ip,
      origin: req.headers.origin ?? null,
    });

    // =========================================================================
    // MESSAGE HANDLER
    // =========================================================================
    ws.on("message", async (data) => {
      const messageStartedAt = process.hrtime.bigint();
      let metricMessageType = "unknown";
      const nowMs = Date.now();
      const raw = typeof data === "string" ? data : (data as Buffer).toString("utf-8");
      const byteLength = Buffer.byteLength(raw, "utf8");

      if (byteLength > opts.maxPayloadBytes) {
        incrementGatewayMetric("ws_validation_failed", { reason: "payload_too_large" });
        ws.close(1009, "Message too large");
        return;
      }

      if (!DEV_BYPASS_RATE_LIMIT && ws.rl && !tryConsume(ws.rl.general, 1, nowMs)) {
        incrementGatewayMetric("ws_rate_limit_rejected", { reason: "general_message_rate" });
        ws.rawMsgStrikes = (ws.rawMsgStrikes ?? 0) + 1;
        if ((ws.rawMsgStrikes ?? 0) >= 3) {
          gatewayLogWarn("Closing websocket due to repeated general message rate limit violations", {
            ip: ws.ip ?? "unknown",
            userId: ws.user?.userId ?? null,
            strikes: ws.rawMsgStrikes,
          });
          ws.close(1013, "Rate limit");
        }
        return;
      }

      const parsedMessage = safeParseClientMessage(raw);
      if (!parsedMessage.success) {
        incrementGatewayMetric("ws_validation_failed", { reason: parsedMessage.error });
        send(ws, "ERROR", { message: parsedMessage.error }, deps);
        return;
      }
      const msg = parsedMessage.data;
      metricMessageType = msg.type;
      incrementGatewayMetric("pvp_ws_inbound_messages_total", { type: msg.type });

      if (!DEV_BYPASS_RATE_LIMIT && msg.type === "INPUT_UPDATE" && ws.rl && !tryConsume(ws.rl.input, 1, nowMs)) {
        incrementGatewayMetric("ws_rate_limit_rejected", { reason: "input_message_rate" });
        return;
      }

      try {
        await routeMessage(ws, msg, req, deps);
      } catch (e: unknown) {
        if (metricMessageType === "HELLO") {
          deps.gatewayMetrics?.incrementWsHandshake("failure");
        }
        const requestId = parsedMessage.success && "requestId" in parsedMessage.data
          ? (parsedMessage.data as { requestId?: string }).requestId
          : undefined;
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
        send(ws, "ERROR", errorPayload, deps);
        if (parsedMessage.success && parsedMessage.data.type === "QUEUE_JOIN") {
          send(ws, "QUEUE_STATUS", { status: "IDLE" }, deps);
        }
      } finally {
        deps.gatewayMetrics?.recordWsMessage({
          direction: "in",
          type: metricMessageType,
          durationSeconds: Number(process.hrtime.bigint() - messageStartedAt) / 1_000_000_000,
        });
      }
    });

    // =========================================================================
    // CLOSE / DISCONNECT HANDLER
    // =========================================================================
    ws.on("close", () => {
      gatewayLogDebug("Websocket connection closed", {
        userId: ws.user?.userId,
        ip: ws.ip ?? "unknown",
        matchId: ws.matchId,
        roomCode: ws.roomCode,
      });

      deps.messageBatcher?.drop(ws);
      if (pingInterval) clearInterval(pingInterval);
      if (ws.presenceInterval) clearInterval(ws.presenceInterval);

      // Update per-IP connection tracking
      if (ws.ip) {
        const next = Math.max(0, (connState.activeConnectionsByIp.get(ws.ip) ?? 1) - 1);
        if (next === 0) {
          connState.activeConnectionsByIp.delete(ws.ip);
        } else {
          connState.activeConnectionsByIp.set(ws.ip, next);
        }
      }
      deps.gatewayMetrics?.setConnectionsActive(wss.clients.size);

      if (ws.user) {
        deps.state.removeFromQueue(ws.user.userId);
        deps.state.clearQueueTimeout(ws.user.userId);
        void deps.queueAdapter.leave(ws.user.userId);
        deps.matchCache?.removeUserSocket(ws);
        deps.releaseMatchSession(ws);
        if (ws.roomCode) {
          deps.matchCache?.removeRoomSocket(ws.roomCode, ws);
        }

        const otherSockets = getAuthedSocketsForUserId(wss, ws.user.userId).filter((s) => s !== ws);
        if (otherSockets.length === 0) {
          const activeMatch = findActiveMatchByUserId(deps, ws.user.userId);
          const matchHasAi = activeMatch
            ? [...activeMatch.participants.keys()].some(isAiUserId)
            : false;

          if (
            !matchHasAi &&
            activeMatch &&
            ws.matchId === activeMatch.matchId &&
            shouldScheduleDisconnectForfeit({
              policy: getDisconnectForfeitPolicy({
                roomCode: activeMatch.roomCode,
                participantCount: activeMatch.participants.size,
              }),
              participantCount: activeMatch.participants.size,
              otherActiveSocketsForUser: 0,
              matchState: activeMatch.state,
              matchStatus: activeMatch.status,
            })
          ) {
            const reconnectUntilMs = Date.now() + opts.disconnectForfeitGraceMs;
            if (!activeMatch.reconnectUntilByUserId) activeMatch.reconnectUntilByUserId = {};
            activeMatch.reconnectUntilByUserId[ws.user.userId] = reconnectUntilMs;
            deps.scheduleDisconnectForfeit(activeMatch.matchId, ws.user.userId);
            void deps.persistReconnectGraceWindow(activeMatch.matchId, ws.user.userId, reconnectUntilMs).catch((err: unknown) => {
              gatewayLogWarn("Failed to persist reconnect grace window", {
                matchId: activeMatch.matchId,
                userId: ws.user?.userId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }
      }

      // ----- Room disconnect logic ----------------------------------------
      if (ws.user && ws.roomCode) {
        const code = ws.roomCode;
        const userId = ws.user.userId;
        void (async () => {
          const roomRows = await deps.db
            .select({ id: pvpRooms.id, code: pvpRooms.code, status: pvpRooms.status })
            .from(pvpRooms)
            .where(eq(pvpRooms.code, code))
            .limit(1);
          const room = roomRows[0] ?? null;
          if (!room) return;

          // If room is OPEN, store a reconnect key so the member can return
          if (room.status === "OPEN" && deps.redisBus?.redis) {
            await deps.redisBus.redis.set(
              buildRoomReconnectKey(room.id, userId),
              deps.instanceId,
              "EX",
              Math.ceil(opts.roomReconnectGraceMs / 1000),
            );
            return;
          }

          // Otherwise mark the member as left
          try {
            await deps.db
              .update(pvpRoomMembers)
              .set({ leftAt: new Date() })
              .where(and(eq(pvpRoomMembers.roomId, room.id), eq(pvpRoomMembers.userId, userId)));
          } catch (err) {
            gatewayLogError("Failed to mark room member offline on socket close", err, {
              roomId: room.id,
              roomCode: room.code,
              userId,
            });
          }

          await transferRoomHostIfNeeded(deps.db, room.id);
          const deleted = await deleteRoomIfEmpty(deps.db, room.id, deps.redisBus);
          if (!deleted) {
            await broadcastRoomState(deps.db, code, deps);
          }
        })().catch((err: unknown) => {
          gatewayLogError("Room post-leave handler failed", err, { code });
        });
      }
    });
  });
}
