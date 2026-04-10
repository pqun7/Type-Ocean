/**
 * @module application/commands/room-start
 * Handles ROOM_START — host manually triggers match start for a private room.
 */

import { and, asc, eq, isNull } from "drizzle-orm";

import { pvpRooms, pvpRoomMembers, users, playerProfiles } from "../../../../../src/db/schema";
import { sanitizeRoomCode } from "../../../../../src/lib/sanitize";
import { isRoomReadyToStart } from "../../rooms/lifecycle";
import { storeIdempotencyHit } from "../match-helpers";
import { send } from "../../presentation/ws-sender";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { loadIdempotencyHit } from "../match-helpers";

export async function handleRoomStart(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "ROOM_START" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  const code = sanitizeRoomCode(msg.payload?.roomCode ?? ws.roomCode ?? "");
  if (!code) {
    send(ws, "ERROR", { message: "No room" }, deps);
    return;
  }

  const roomRows = await deps.db
    .select({ id: pvpRooms.id, code: pvpRooms.code, status: pvpRooms.status, hostUserId: pvpRooms.hostUserId })
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
  if (room.hostUserId !== ws.user!.userId) {
    send(ws, "ERROR", { message: "Host only action" }, deps);
    return;
  }

  const memberRows = await deps.db
    .select({
      userId: pvpRoomMembers.userId,
      colorSlot: pvpRoomMembers.colorSlot,
      readyAt: pvpRoomMembers.readyAt,
      leftAt: pvpRoomMembers.leftAt,
      username: users.username,
      avatar: playerProfiles.avatar,
    })
    .from(pvpRoomMembers)
    .innerJoin(users, eq(pvpRoomMembers.userId, users.id))
    .leftJoin(playerProfiles, eq(pvpRoomMembers.userId, playerProfiles.userId))
    .where(and(eq(pvpRoomMembers.roomId, room.id), isNull(pvpRoomMembers.leftAt)))
    .orderBy(asc(pvpRoomMembers.joinedAt));

  const members = memberRows.map((member) => ({
    userId: member.userId,
    colorSlot: member.colorSlot,
    readyAt: member.readyAt,
    leftAt: member.leftAt,
    user: {
      username: member.username,
      profile: { avatar: member.avatar },
    },
  }));

  if (!isRoomReadyToStart({ members })) {
    send(ws, "ERROR", { message: "All players must be ready before the host can start" }, deps);
    return;
  }

  await deps.startRoomMatch({
    roomId: room.id,
    roomCode: code,
    members,
  });

  await storeIdempotencyHit({
    redis: deps.redisBus?.redis ?? null,
    store: deps.idempotencyStore,
    key: idempotency?.key,
    messageType: msg.type,
    value: { response: null },
  });
}
