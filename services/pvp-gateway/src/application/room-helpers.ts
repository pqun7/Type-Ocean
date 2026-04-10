/**
 * @module application/room-helpers
 *
 * Room lifecycle helpers: expiry, host transfer, state loading,
 * broadcasting, sweep, and post-match restore.
 *
 * ## Import policy
 * May import from: shared/, presentation/ws-sender, application/deps,
 * drizzle schema, rooms/lifecycle, gateway-db (type), state (type).
 */

import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

import { pvpRooms, pvpRoomMembers } from "../../../../src/db/schema";
import { sanitizeAvatarUrl, sanitizeDisplayName } from "../../../../src/lib/sanitize";
import { runGatewayTransaction, type GatewayDb } from "../gateway-db";
import { buildRoomReconnectKey, selectNextRoomHost } from "../rooms/lifecycle";
import { nextRoomExpiryDate, ONLINE_KEY_PREFIX } from "../shared/config";
import { gatewayLogError } from "../shared/logger";
import { broadcastRoom, getAuthedSocketsForUser } from "../presentation/ws-sender";
import type { GatewayDeps } from "./deps";

// =============================================================================
// ROOM EXPIRY
// =============================================================================

/** Bump a room's `expiresAt` to the next standard expiry date. */
export async function touchRoomExpiry(db: GatewayDb, roomId: string): Promise<void> {
  await db
    .update(pvpRooms)
    .set({ expiresAt: nextRoomExpiryDate(), updatedAt: new Date() })
    .where(eq(pvpRooms.id, roomId));
}

// =============================================================================
// HOST TRANSFER
// =============================================================================

/**
 * If the current host has left the room, select the next eligible member and
 * update the DB.  Returns the `userId` of the (possibly unchanged) host.
 */
export async function transferRoomHostIfNeeded(db: GatewayDb, roomId: string): Promise<string | null> {
  const room = await db.query.pvpRooms.findFirst({
    columns: { id: true, hostUserId: true },
    where: eq(pvpRooms.id, roomId),
    with: {
      members: {
        columns: { userId: true, joinedAt: true, readyAt: true, leftAt: true },
        orderBy: asc(pvpRoomMembers.joinedAt),
      },
    },
  });

  if (!room) return null;

  const nextHostUserId = selectNextRoomHost(room.members, room.hostUserId);
  if (!nextHostUserId || nextHostUserId === room.hostUserId) return nextHostUserId;

  await db
    .update(pvpRooms)
    .set({ hostUserId: nextHostUserId, updatedAt: new Date() })
    .where(eq(pvpRooms.id, roomId));

  return nextHostUserId;
}

// =============================================================================
// ROOM STATE PAYLOAD
// =============================================================================

/** Return type for the room state payload loaded from the DB. */
export interface RoomStatePayload {
  roomId: string;
  room: {
    code: string;
    status: string;
    minPlayers: number;
    maxPlayers: number;
    hostUserId: string | null;
    expiresAt: string | null;
    members: Array<{
      userId: string;
      username: string;
      avatar: string | null;
      slot: number;
      ready: boolean;
      joinedAt: Date;
      leftAt: Date | null;
    }>;
  };
}

/**
 * Load the full room state from the DB, returning `null` if the room does
 * not exist.
 */
export async function loadRoomStatePayload(
  db: GatewayDb,
  roomCode: string,
): Promise<RoomStatePayload | null> {
  const room = await db.query.pvpRooms.findFirst({
    columns: {
      id: true,
      code: true,
      status: true,
      minPlayers: true,
      maxPlayers: true,
      hostUserId: true,
      expiresAt: true,
    },
    where: eq(pvpRooms.code, roomCode),
    with: {
      members: {
        columns: {
          userId: true,
          colorSlot: true,
          readyAt: true,
          joinedAt: true,
          leftAt: true,
        },
        where: isNull(pvpRoomMembers.leftAt),
        orderBy: asc(pvpRoomMembers.joinedAt),
        with: {
          user: {
            columns: { username: true },
            with: { profile: { columns: { avatar: true } } },
          },
        },
      },
    },
  });

  if (!room) return null;

  return {
    roomId: room.id,
    room: {
      code: room.code,
      status: room.status,
      minPlayers: room.minPlayers,
      maxPlayers: room.maxPlayers,
      hostUserId: room.hostUserId,
      expiresAt: room.expiresAt?.toISOString() ?? null,
      members: room.members.map((member) => ({
        userId: member.userId,
        username: sanitizeDisplayName(member.user.username, 32) || "user",
        avatar: sanitizeAvatarUrl(member.user.profile?.avatar ?? null),
        slot: member.colorSlot,
        ready: !!member.readyAt,
        joinedAt: member.joinedAt,
        leftAt: member.leftAt,
      })),
    },
  };
}

// =============================================================================
// BROADCAST ROOM STATE
// =============================================================================

/**
 * Load the current room state from the DB and broadcast `ROOM_STATE` to all
 * connected members.  Returns the payload, or `null` if the room was not found.
 */
export async function broadcastRoomState(
  db: GatewayDb,
  roomCode: string,
  deps: Pick<GatewayDeps, "redisBus" | "matchCache" | "messageBatcher" | "gatewayMetrics">,
): Promise<RoomStatePayload | null> {
  const payload = await loadRoomStatePayload(db, roomCode);
  if (!payload) return null;

  broadcastRoom(roomCode, "ROOM_STATE", {
    room: {
      code: payload.room.code,
      status: payload.room.status,
      minPlayers: payload.room.minPlayers,
      maxPlayers: payload.room.maxPlayers,
      hostUserId: payload.room.hostUserId,
      expiresAt: payload.room.expiresAt,
      members: payload.room.members.map((member) => ({
        userId: member.userId,
        username: member.username,
        avatar: member.avatar,
        slot: member.slot,
        ready: member.ready,
      })),
    },
  }, deps);

  return payload;
}

// =============================================================================
// ROOM LIFECYCLE SWEEP
// =============================================================================

const ROOM_SWEEP_LOCK_REDIS_KEY = "pvp:room:sweep:lock";

async function tryAcquireRoomSweepLock(
  deps: Pick<GatewayDeps, "redisBus" | "instanceId">,
): Promise<boolean> {
  const redis = deps.redisBus?.redis ?? null;
  if (!redis) return true;
  const token = `${deps.instanceId}:${Date.now()}`;
  const acquired = await redis.set(ROOM_SWEEP_LOCK_REDIS_KEY, token, "EX", 10, "NX");
  return acquired === "OK";
}

/**
 * Sweep open rooms: evict offline members, transfer hosts, and expire rooms.
 */
export async function sweepRoomLifecycle(
  db: GatewayDb,
  deps: Pick<
    GatewayDeps,
    "redisBus" | "matchCache" | "messageBatcher" | "gatewayMetrics" | "instanceId"
  >,
): Promise<void> {
  const redis = deps.redisBus?.redis ?? null;
  const acquired = await tryAcquireRoomSweepLock(deps);
  if (!acquired) return;

  const now = Date.now();
  const rooms = await db.query.pvpRooms.findMany({
    columns: { id: true, code: true, expiresAt: true, status: true },
    where: or(eq(pvpRooms.status, "OPEN"), lte(pvpRooms.expiresAt, new Date(now))),
    with: {
      members: {
        columns: { userId: true, joinedAt: true, readyAt: true, leftAt: true },
        orderBy: asc(pvpRoomMembers.joinedAt),
      },
    },
  });

  for (const room of rooms) {
    const roomMembers = room.members;

    if (room.expiresAt && room.expiresAt.getTime() <= now) {
      broadcastRoom(room.code, "ERROR", { message: "Room expired" }, deps);
      try {
        await db.delete(pvpRooms).where(eq(pvpRooms.id, room.id));
      } catch (error) {
        gatewayLogError("Failed to delete expired room", error, {
          roomId: room.id,
          roomCode: room.code,
        });
        throw error;
      }
      continue;
    }

    let changed = false;
    for (const member of roomMembers) {
      if (member.leftAt) continue;
      const reconnectKey = buildRoomReconnectKey(room.id, member.userId);
      const hasReconnectLease = redis ? (await redis.exists(reconnectKey)) === 1 : false;
      const isOnline = redis
        ? (await redis.exists(`${ONLINE_KEY_PREFIX}${member.userId}`)) === 1
        : getAuthedSocketsForUser(member.userId, deps).length > 0;
      if (isOnline || hasReconnectLease) continue;

      await db
        .update(pvpRoomMembers)
        .set({ leftAt: new Date() })
        .where(
          and(
            eq(pvpRoomMembers.roomId, room.id),
            eq(pvpRoomMembers.userId, member.userId),
          ),
        );
      changed = true;
    }

    if (changed) {
      await transferRoomHostIfNeeded(db, room.id);
      await broadcastRoomState(db, room.code, deps);
    }
  }
}

// =============================================================================
// POST-MATCH ROOM RESTORE
// =============================================================================

/**
 * Restore a room back to `OPEN` state after a match concludes,
 * clearing all readiness flags.
 */
export async function restoreRoomAfterMatch(
  db: GatewayDb,
  roomCode: string,
  deps: Pick<GatewayDeps, "redisBus" | "matchCache" | "messageBatcher" | "gatewayMetrics">,
): Promise<void> {
  const roomRows = await db
    .select({
      id: pvpRooms.id,
    })
    .from(pvpRooms)
    .where(eq(pvpRooms.code, roomCode))
    .limit(1);

  const room = roomRows[0] ?? null;
  if (!room) return;

  await runGatewayTransaction(db, async (tx) => {
    await tx
      .update(pvpRooms)
      .set({
        status: "OPEN",
        autoStartAt: null,
        expiresAt: nextRoomExpiryDate(),
        updatedAt: new Date(),
      })
      .where(eq(pvpRooms.id, room.id));

    await tx
      .update(pvpRoomMembers)
      .set({ readyAt: null })
      .where(and(eq(pvpRoomMembers.roomId, room.id), isNull(pvpRoomMembers.leftAt)));
  });

  await broadcastRoomState(db, roomCode, deps);
}
