/**
 * @module application/commands/room-leave
 * Handles ROOM_LEAVE — player voluntarily leaves a room.
 */

import { and, eq } from "drizzle-orm";

import { pvpRooms, pvpRoomMembers } from "../../../../../src/db/schema";
import { sanitizeRoomCode } from "../../../../../src/lib/sanitize";
import { buildRoomReconnectKey } from "../../rooms/lifecycle";
import { touchRoomExpiry, transferRoomHostIfNeeded, broadcastRoomState } from "../room-helpers";
import { storeIdempotencyHit } from "../match-helpers";
import { send } from "../../presentation/ws-sender";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { loadIdempotencyHit } from "../match-helpers";

export async function handleRoomLeave(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "ROOM_LEAVE" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  const code = sanitizeRoomCode(msg.payload?.roomCode ?? ws.roomCode ?? "");
  if (!code) {
    send(ws, "ERROR", { message: "No room" }, deps);
    return;
  }

  const roomRows = await deps.db
    .select({ id: pvpRooms.id, code: pvpRooms.code, status: pvpRooms.status })
    .from(pvpRooms)
    .where(eq(pvpRooms.code, code))
    .limit(1);
  const room = roomRows[0] ?? null;
  if (!room) {
    send(ws, "ERROR", { message: "Room not found" }, deps);
    return;
  }

  await deps.db
    .update(pvpRoomMembers)
    .set({ leftAt: new Date(), readyAt: null })
    .where(and(eq(pvpRoomMembers.roomId, room.id), eq(pvpRoomMembers.userId, ws.user!.userId)));

  if (deps.redisBus?.redis) {
    await deps.redisBus.redis.del(buildRoomReconnectKey(room.id, ws.user!.userId));
  }

  deps.updateSocketRoomSubscription(ws, undefined);
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
