/**
 * @module application/commands/ready
 * Handles READY — player signals readiness in a private room.
 */

import { and, eq } from "drizzle-orm";

import { pvpRooms, pvpRoomMembers } from "../../../../../src/db/schema";
import { sanitizeRoomCode } from "../../../../../src/lib/sanitize";
import { touchRoomExpiry, broadcastRoomState } from "../room-helpers";
import { storeIdempotencyHit } from "../match-helpers";
import { send } from "../../presentation/ws-sender";
import { incrementGatewayMetric } from "../../metrics";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { loadIdempotencyHit } from "../match-helpers";

export async function handleReady(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "READY" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  const roomActionKey = `${ws.user!.userId}:ready`;
  const now = Date.now();
  const lastRoomAction = deps.roomActionLastSeen.get(roomActionKey) ?? 0;
  if (now - lastRoomAction < deps.roomActionCooldownMs) {
    incrementGatewayMetric("ws_rate_limit_rejected", { reason: "ready_cooldown" });
    send(ws, "ERROR", { message: "Ready cooldown active" }, deps);
    return;
  }
  deps.roomActionLastSeen.set(roomActionKey, now);

  const code = sanitizeRoomCode(msg.payload?.roomCode ?? ws.roomCode ?? "");
  if (!code) {
    send(ws, "ERROR", { message: "No room" }, deps);
    return;
  }

  const roomRows = await deps.db
    .select({ id: pvpRooms.id, code: pvpRooms.code, status: pvpRooms.status, maxPlayers: pvpRooms.maxPlayers })
    .from(pvpRooms)
    .where(eq(pvpRooms.code, code))
    .limit(1);
  const room = roomRows[0] ?? null;
  if (!room) {
    send(ws, "ERROR", { message: "Room not found" }, deps);
    return;
  }
  if (room.status !== "OPEN") {
    send(ws, "ERROR", { message: "Room not open" }, deps);
    return;
  }

  await deps.db
    .update(pvpRoomMembers)
    .set({ readyAt: new Date() })
    .where(and(eq(pvpRoomMembers.roomId, room.id), eq(pvpRoomMembers.userId, ws.user!.userId)));

  await touchRoomExpiry(deps.db, room.id);
  await broadcastRoomState(deps.db, code, deps);

  await storeIdempotencyHit({
    redis: deps.redisBus?.redis ?? null,
    store: deps.idempotencyStore,
    key: idempotency?.key,
    messageType: msg.type,
    value: { response: null },
  });
}
