/**
 * @module presentation/ws-sender
 *
 * WebSocket message sending utilities.
 *
 * All outbound message helpers live here so they can be imported by command
 * handlers without pulling in the full `index.ts` module.  Every function
 * accepts a `GatewayDeps` instance and reads `deps.messageBatcher`,
 * `deps.gatewayMetrics`, `deps.redisBus`, `deps.matchCache`, and
 * `deps.wss` from it rather than from module-level globals.
 *
 * ## Import policy
 * May import from:  shared/, presentation/ws-conn, application/deps, ws, protocol
 */

import { WebSocket } from "ws";

import { toJson, type ServerMessage } from "../protocol";
import {
  incrementGatewayMetric,
  observeGatewayHistogram,
} from "../metrics";
import { isBatchableServerMessage } from "../message-batcher";
import { userChannel, matchChannel, roomChannel } from "../redis-bus";
import { gatewayLogWarn } from "../shared/logger";
import { WS_MESSAGE_SIZE_BUCKETS } from "../shared/config";
import type { WsConn } from "./ws-conn";
import type { GatewayDeps } from "../application/deps";

// =============================================================================
// IMMEDIATE SEND (bypass batcher)
// =============================================================================

/**
 * Send a message directly to one socket, bypassing the message batcher.
 * Use for high-priority messages (MATCH_FOUND, MATCH_ENDED, ERROR).
 */
export function sendImmediate(
  ws: WsConn,
  type: ServerMessage["type"],
  payload: unknown,
  deps: Pick<GatewayDeps, "gatewayMetrics">,
): void {
  try {
    const serialized = toJson({ type, payload });
    incrementGatewayMetric("pvp_ws_outbound_messages_total", { type, batching: "immediate" });
    deps.gatewayMetrics?.recordWsMessage({ direction: "out", type });
    observeGatewayHistogram(
      "pvp_ws_outbound_message_bytes",
      Buffer.byteLength(serialized, "utf8"),
      WS_MESSAGE_SIZE_BUCKETS as unknown as number[],
      { type, batching: "immediate" },
    );
    if (type === "ERROR") {
      gatewayLogWarn("Sending websocket ERROR message", {
        userId: ws.user?.userId ?? null,
        matchId: ws.matchId ?? null,
        payload,
      });
    }
    ws.send(serialized);
  } catch {
    // Ignore — socket may have closed between readyState check and send.
  }
}

// =============================================================================
// BATCHED SEND
// =============================================================================

/**
 * Enqueue a message for batched delivery, or send immediately if batching
 * is disabled or the message type is not batchable.
 */
export function send(
  ws: WsConn,
  type: ServerMessage["type"],
  payload: unknown,
  deps: Pick<GatewayDeps, "messageBatcher" | "gatewayMetrics">,
): void {
  const { messageBatcher } = deps;

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

  sendImmediate(ws, type, payload, deps);
}

// =============================================================================
// PER-USER HELPERS
// =============================================================================

/**
 * Return all open, authenticated sockets for a user, using the match-cache
 * socket index when available.
 */
export function getAuthedSocketsForUser(userId: string, deps: Pick<GatewayDeps, "matchCache">): WsConn[] {
  const conns: WsConn[] = [];
  const cachedSockets = deps.matchCache?.getUserSockets(userId);
  if (!cachedSockets || cachedSockets.size === 0) return conns;

  for (const socket of cachedSockets) {
    const c = socket as WsConn;
    if (c.readyState !== WebSocket.OPEN) continue;
    conns.push(c);
  }
  return conns;
}

/**
 * Deliver a message to all sockets owned by `userId`.
 * If Redis is enabled, publishes to the user channel so other gateway
 * replicas forward the message locally.
 */
export function sendToUser(
  userId: string,
  type: ServerMessage["type"],
  payload: unknown,
  deps: Pick<GatewayDeps, "redisBus" | "matchCache" | "messageBatcher" | "gatewayMetrics">,
): void {
  if (deps.redisBus) {
    void deps.redisBus.publish(userChannel(userId), { type, payload });
    return;
  }
  for (const c of getAuthedSocketsForUser(userId, deps)) {
    send(c, type, payload, deps);
  }
}

// =============================================================================
// BROADCAST HELPERS
// =============================================================================

/**
 * Broadcast a message to every socket subscribed to a room.
 * If Redis is enabled, publishes to the room channel so all replicas forward.
 */
export function broadcastRoom(
  roomCode: string,
  type: ServerMessage["type"],
  payload: unknown,
  deps: Pick<GatewayDeps, "redisBus" | "matchCache" | "messageBatcher" | "gatewayMetrics">,
): void {
  if (deps.redisBus) {
    void deps.redisBus.publish(roomChannel(roomCode), { type, payload });
    return;
  }
  const roomSockets = deps.matchCache?.getRoomSockets(roomCode);
  if (!roomSockets || roomSockets.size === 0) return;

  for (const socket of roomSockets) {
    const c = socket as WsConn;
    if (c.readyState !== WebSocket.OPEN) continue;
    send(c, type, payload, deps);
  }
}

/**
 * Broadcast a message to every socket participating in a match.
 * Also publishes to the Redis match channel when Redis is enabled.
 */
export function broadcastMatch(
  matchId: string,
  type: ServerMessage["type"],
  payload: unknown,
  deps: Pick<GatewayDeps, "redisBus" | "matchCache" | "messageBatcher" | "gatewayMetrics">,
): void {
  const cachedSockets = deps.matchCache?.getMatchSockets(matchId);
  if (cachedSockets && cachedSockets.size > 0) {
    for (const socket of cachedSockets) {
      send(socket as WsConn, type, payload, deps);
    }
  }

  if (deps.redisBus) {
    void deps.redisBus.publish(matchChannel(matchId), { type, payload });
  }
}
