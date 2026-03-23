/**
 * @module application/commands/room-kick
 * Handles ROOM_KICK — host removes a member from a private room.
 */

import { and, eq } from "drizzle-orm";

import { pvpRooms, pvpRoomMembers } from "../../../../../src/db/schema";
import { sanitizeRoomCode } from "../../../../../src/lib/sanitize";
import { buildRoomReconnectKey } from "../../rooms/lifecycle";
import { touchRoomExpiry, transferRoomHostIfNeeded, broadcastRoomState } from "../room-helpers";
import { storeIdempotencyHit } from "../match-helpers";
import { send, sendToUser } from "../../presentation/ws-sender";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { loadIdempotencyHit } from "../match-helpers";

export async function handleRoomKick(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "ROOM_KICK" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  const code = sanitizeRoomCode(msg.payload?.roomCode ?? ws.roomCode ?? "");
  if (!code) {
    send(ws, "ERROR", { message: "No room" }, deps);
    return;
  }

  const roomRows = await deps.db
    .select({ id: pvpRooms.id, code: pvpRooms.code, status: pvpRooms.status, visibility: pvpRooms.visibility, hostUserId: pvpRooms.hostUserId })
    .from(pvpRooms)
    .where(eq(pvpRooms.code, code))
    .limit(1);
  const room = roomRows[0] ?? null;
  if (!room) {
    send(ws, "ERROR", { message: "Room not found" }, deps);
    return;
  }
  if (room.visibility !== "PRIVATE") {
    send(ws, "ERROR", { message: "Public rooms do not support host kicks" }, deps);
    return;
  }
  if (room.hostUserId !== ws.user!.userId) {
    send(ws, "ERROR", { message: "Host only action" }, deps);
    return;
  }
  if (msg.payload.userId === ws.user!.userId) {
    send(ws, "ERROR", { message: "Host cannot kick itself" }, deps);
    return;
  }

  await deps.db
    .update(pvpRoomMembers)
    .set({ leftAt: new Date(), readyAt: null })
    .where(and(eq(pvpRoomMembers.roomId, room.id), eq(pvpRoomMembers.userId, msg.payload.userId)));

  if (deps.redisBus?.redis) {
    await deps.redisBus.redis.del(buildRoomReconnectKey(room.id, msg.payload.userId));
  }

  sendToUser(msg.payload.userId, "ERROR", { message: "Kicked from room" }, deps);
  await transferRoomHostIfNeeded(deps.db, room.id);
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
