/**
 * @module presentation/ws-router
 *
 * Routes an already-parsed ClientMessage to the appropriate command handler.
 * Performs auth checks, sensitive-operation token-state validation, and
 * idempotency short-circuiting before dispatching.
 */

import type { IncomingMessage } from "http";

import { assertWsTokenState } from "../auth";
import { loadIdempotencyHit } from "../application/match-helpers";
import { send } from "./ws-sender";
import {
  handleHello,
  handleAuthRefresh,
  handleQueueJoin,
  handleQueueLeave,
  handleMatchJoin,
  handleMatchLeave,
  handleInputUpdate,
  handleFinish,
  handleRematchRequest,
  handleRematchResponse,
  handleRoomJoin,
  handleReady,
  handleRoomStart,
  handleRoomKick,
  handleRoomLeave,
} from "../application/commands/index";

import type { WsConn } from "./ws-conn";
import type { ClientMessage } from "../protocol";
import type { GatewayDeps } from "../application/deps";

// =============================================================================
// ROUTE MESSAGE
// =============================================================================

/**
 * Dispatch a parsed ClientMessage to its command handler.
 *
 * Returns the message type string (for metrics), or throws on fatal error.
 */
export async function routeMessage(
  ws: WsConn,
  msg: ClientMessage,
  req: IncomingMessage,
  deps: GatewayDeps,
): Promise<void> {
  // -------------------------------------------------------------------------
  // HELLO — unauthenticated, no idempotency
  // -------------------------------------------------------------------------
  if (msg.type === "HELLO") {
    await handleHello(ws, msg, req, deps);
    return;
  }

  // -------------------------------------------------------------------------
  // AUTH_REFRESH — handler checks ws.user internally, no idempotency
  // -------------------------------------------------------------------------
  if (msg.type === "AUTH_REFRESH") {
    await handleAuthRefresh(ws, msg, req, deps);
    return;
  }

  // -------------------------------------------------------------------------
  // PING — application-level heartbeat; reply with PONG (auth not required)
  // -------------------------------------------------------------------------
  if (msg.type === "PING") {
    if (ws.user) send(ws, "PONG", {}, deps);
    return;
  }

  // -------------------------------------------------------------------------
  // All other messages require an authenticated connection
  // -------------------------------------------------------------------------
  if (!ws.user) {
    send(ws, "ERROR", { message: "Unauthenticated" }, deps);
    return;
  }

  // -------------------------------------------------------------------------
  // Token-state validation for sensitive queue / match-join operations
  // -------------------------------------------------------------------------
  if ((msg.type === "QUEUE_JOIN" || msg.type === "MATCH_JOIN") && !ws.authBypass) {
    await assertWsTokenState(deps.db, {
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

  // -------------------------------------------------------------------------
  // Idempotency short-circuit
  // -------------------------------------------------------------------------
  const idempotency = await loadIdempotencyHit({
    redis: deps.redisBus?.redis ?? null,
    store: deps.idempotencyStore,
    eventBus: deps.eventBus,
    userId: ws.user.userId,
    messageType: msg.type,
    requestId: "requestId" in msg ? (msg as { requestId?: string }).requestId : undefined,
  });
  if (idempotency?.record) {
    if (idempotency.record.response) {
      send(ws, idempotency.record.response.type, idempotency.record.response.payload, deps);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // Dispatch to command handlers
  // -------------------------------------------------------------------------
  switch (msg.type) {
    case "QUEUE_JOIN":
      await handleQueueJoin(ws, msg, deps, idempotency);
      break;
    case "QUEUE_LEAVE":
      await handleQueueLeave(ws, msg, deps, idempotency);
      break;
    case "MATCH_JOIN":
      await handleMatchJoin(ws, msg, deps, idempotency);
      break;
    case "MATCH_LEAVE":
      await handleMatchLeave(ws, msg, deps);
      break;
    case "INPUT_UPDATE":
      await handleInputUpdate(ws, msg, deps, idempotency);
      break;
    case "FINISH":
      await handleFinish(ws, msg, deps, idempotency);
      break;
    case "REMATCH_REQUEST":
      await handleRematchRequest(ws, msg, deps);
      break;
    case "REMATCH_RESPONSE":
      await handleRematchResponse(ws, msg, deps);
      break;
    case "ROOM_JOIN":
      await handleRoomJoin(ws, msg, deps, idempotency);
      break;
    case "READY":
      await handleReady(ws, msg, deps, idempotency);
      break;
    case "ROOM_START":
      await handleRoomStart(ws, msg, deps, idempotency);
      break;
    case "ROOM_KICK":
      await handleRoomKick(ws, msg, deps, idempotency);
      break;
    case "ROOM_LEAVE":
      await handleRoomLeave(ws, msg, deps, idempotency);
      break;
    default: {
      const _exhaustiveCheck: never = msg;
      void _exhaustiveCheck;
    }
  }
}
