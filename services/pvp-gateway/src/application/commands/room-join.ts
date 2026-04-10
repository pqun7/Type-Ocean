/**
 * @module application/commands/room-join
 * Handles ROOM_JOIN — join or reconnect to a private room.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { pvpRooms, pvpRoomMembers, users, playerProfiles } from "../../../../../src/db/schema";
import { sanitizeRoomCode } from "../../../../../src/lib/sanitize";
import { buildRoomReconnectKey } from "../../rooms/lifecycle";
import { touchRoomExpiry, broadcastRoomState } from "../room-helpers";
import { storeIdempotencyHit } from "../match-helpers";
import { send } from "../../presentation/ws-sender";
import { incrementGatewayMetric } from "../../metrics";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { loadIdempotencyHit } from "../match-helpers";

export async function handleRoomJoin(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "ROOM_JOIN" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  const roomActionKey = `${ws.user!.userId}:room_join`;
  const now = Date.now();
  const lastRoomAction = deps.roomActionLastSeen.get(roomActionKey) ?? 0;
  if (now - lastRoomAction < deps.roomActionCooldownMs) {
    incrementGatewayMetric("ws_rate_limit_rejected", { reason: "room_join_cooldown" });
    send(ws, "ERROR", { message: "Room join cooldown active" }, deps);
    return;
  }
  deps.roomActionLastSeen.set(roomActionKey, now);

  const code = sanitizeRoomCode(msg.payload.code);
  if (code.length < 4) {
    incrementGatewayMetric("ws_validation_failed", { reason: "room_code_invalid" });
    send(ws, "ERROR", { message: "Invalid room code" }, deps);
    return;
  }

  const previousRoomCode = ws.roomCode;

  const roomRows = await deps.db
    .select({
      id: pvpRooms.id,
      code: pvpRooms.code,
      status: pvpRooms.status,
      minPlayers: pvpRooms.minPlayers,
      maxPlayers: pvpRooms.maxPlayers,
      expiresAt: pvpRooms.expiresAt,
      hostUserId: pvpRooms.hostUserId,
    })
    .from(pvpRooms)
    .where(eq(pvpRooms.code, code))
    .limit(1);

  const room = roomRows[0] ?? null;
  if (!room) {
    send(ws, "ERROR", { message: "Room not found" }, deps);
    return;
  }
  if (room.expiresAt && room.expiresAt.getTime() < Date.now()) {
    send(ws, "ERROR", { message: "Room expired" }, deps);
    return;
  }
  if (room.status !== "OPEN") {
    send(ws, "ERROR", { message: "Room not open" }, deps);
    return;
  }

  const members = await deps.db
    .select({
      userId: pvpRoomMembers.userId,
      colorSlot: pvpRoomMembers.colorSlot,
      readyAt: pvpRoomMembers.readyAt,
      username: users.username,
      avatar: playerProfiles.avatar,
    })
    .from(pvpRoomMembers)
    .innerJoin(users, eq(pvpRoomMembers.userId, users.id))
    .leftJoin(playerProfiles, eq(pvpRoomMembers.userId, playerProfiles.userId))
    .where(and(eq(pvpRoomMembers.roomId, room.id), isNull(pvpRoomMembers.leftAt)));

  const existingMember = members.find((m) => m.userId === ws.user!.userId) ?? null;

  if (members.length >= room.maxPlayers && !existingMember) {
    send(ws, "ERROR", { message: "Room full" }, deps);
    return;
  }

  const used = new Set(members.map((m) => m.colorSlot));
  let slot = existingMember?.colorSlot ?? 0;
  if (!existingMember) {
    while (used.has(slot) && slot < room.maxPlayers) slot += 1;
    if (slot >= room.maxPlayers) slot = Math.min(room.maxPlayers - 1, 5);
  }

  const reconnectKey = buildRoomReconnectKey(room.id, ws.user!.userId);
  const restoringMembership = deps.redisBus ? (await deps.redisBus.redis.exists(reconnectKey)) === 1 : false;

  if (existingMember) {
    // Already an active member (leftAt IS NULL) — just de-ready them, no upsert needed.
    await deps.db
      .update(pvpRoomMembers)
      .set({ readyAt: sql`null` })
      .where(and(eq(pvpRoomMembers.roomId, room.id), eq(pvpRoomMembers.userId, ws.user!.userId)));
  } else {
    // New member or reconnecting (leftAt was set). Use SQL NULL literals in the SET
    // clause to avoid driver-level null-parameter type-inference issues with
    // the neon-serverless pool on timestamp columns.
    await deps.db
      .insert(pvpRoomMembers)
      .values({ roomId: room.id, userId: ws.user!.userId, colorSlot: slot, leftAt: null, readyAt: null })
      .onConflictDoUpdate({
        target: [pvpRoomMembers.roomId, pvpRoomMembers.userId],
        set: restoringMembership
          ? { leftAt: sql`null` }
          : { leftAt: sql`null`, readyAt: sql`null` },
      });
  }

  if (deps.redisBus && restoringMembership) {
    await deps.redisBus.redis.del(reconnectKey);
  }

  deps.updateSocketRoomSubscription(ws, code);
  if (previousRoomCode && previousRoomCode !== code) {
    // subscription moved — no log needed in extracted handler
  }

  await touchRoomExpiry(deps.db, room.id);

  if (!room.hostUserId) {
    await deps.db
      .update(pvpRooms)
      .set({ hostUserId: ws.user!.userId, updatedAt: new Date() })
      .where(eq(pvpRooms.id, room.id));
  }

  await broadcastRoomState(deps.db, code, deps);

  await storeIdempotencyHit({
    redis: deps.redisBus?.redis ?? null,
    store: deps.idempotencyStore,
    key: idempotency?.key,
    messageType: msg.type,
    value: { response: null },
  });
}
