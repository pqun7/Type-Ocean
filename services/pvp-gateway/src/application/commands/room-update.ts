/**
 * @module application/commands/room-update
 * Handles ROOM_UPDATE — host updates room settings (maxPlayers).
 */

import { eq } from "drizzle-orm";

import { pvpRooms } from "../../../../../src/db/schema";
import { sanitizeRoomCode } from "../../../../../src/lib/sanitize";
import { broadcastRoomState } from "../room-helpers";
import { storeIdempotencyHit } from "../match-helpers";
import { send } from "../../presentation/ws-sender";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { loadIdempotencyHit } from "../match-helpers";

export async function handleRoomUpdate(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "ROOM_UPDATE" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  if (!ws.user) {
    send(ws, "ERROR", { message: "Unauthenticated" }, deps);
    return;
  }

  const code = sanitizeRoomCode(msg.payload?.roomCode ?? ws.roomCode ?? "");
  if (!code) {
    send(ws, "ERROR", { message: "Not in a room" }, deps);
    return;
  }

  const roomRows = await deps.db
    .select({
      id: pvpRooms.id,
      code: pvpRooms.code,
      status: pvpRooms.status,
      hostUserId: pvpRooms.hostUserId,
      minPlayers: pvpRooms.minPlayers,
      maxPlayers: pvpRooms.maxPlayers,
    })
    .from(pvpRooms)
    .where(eq(pvpRooms.code, code))
    .limit(1);

  const room = roomRows[0] ?? null;
  if (!room) {
    send(ws, "ERROR", { message: "Room not found" }, deps);
    return;
  }
  if (room.hostUserId !== ws.user.userId) {
    send(ws, "ERROR", { message: "Host only action" }, deps);
    return;
  }
  if (room.status !== "OPEN") {
    send(ws, "ERROR", { message: "Cannot update room that is not open" }, deps);
    return;
  }

  const newMaxPlayers = msg.payload.maxPlayers;

  // Load current active member count to guard against lowering below current occupancy
  const payload = await broadcastRoomState(deps.db, code, deps);
  const activeMemberCount = payload?.room.members.length ?? 0;
  if (newMaxPlayers < activeMemberCount) {
    send(ws, "ERROR", { message: `Cannot set max players below current occupancy (${activeMemberCount})` }, deps);
    return;
  }

  await deps.db
    .update(pvpRooms)
    .set({ maxPlayers: newMaxPlayers, updatedAt: new Date() })
    .where(eq(pvpRooms.id, room.id));

  // Broadcast updated state to all members
  await broadcastRoomState(deps.db, code, deps);

  await storeIdempotencyHit({
    redis: deps.redisBus?.redis ?? null,
    store: deps.idempotencyStore,
    key: idempotency?.key,
    messageType: msg.type,
    value: { response: null },
  });
}
