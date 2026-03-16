export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { count, eq } from "drizzle-orm";

import { db } from "@/db";
import { pvpMatches, pvpRoomMembers, pvpRooms } from "@/db/schema";
import { authorizeAdminRequest } from "@/app/api/shared.server";
import { createAdminAuditLog } from "@/features/admin/server/audit-log";

const PUBLIC_ROOM_AUTO_START_MS = 50_000;

const AdminRoomActionSchema = z.object({
  roomId: z.string().min(1),
  action: z.enum(["close", "reopen", "make_public", "make_private"]),
});

export async function PATCH(req: NextRequest) {
  const adminUserId = await authorizeAdminRequest(req);
  if (!adminUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = AdminRoomActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const existingRoomRows = await db
    .select({
      id: pvpRooms.id,
      code: pvpRooms.code,
      status: pvpRooms.status,
      visibility: pvpRooms.visibility,
      hostUserId: pvpRooms.hostUserId,
    })
    .from(pvpRooms)
    .where(eq(pvpRooms.id, parsed.data.roomId))
    .limit(1);

  const existingRoom = existingRoomRows[0] ?? null;

  if (!existingRoom) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const patchByAction: Record<typeof parsed.data.action, Record<string, unknown>> = {
    close: {
      status: "CLOSED",
      expiresAt: new Date(),
      autoStartAt: null,
    },
    reopen: {
      status: "OPEN",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      autoStartAt: existingRoom.visibility === "PUBLIC" ? new Date(Date.now() + PUBLIC_ROOM_AUTO_START_MS) : null,
    },
    make_public: {
      visibility: "PUBLIC",
      autoStartAt: existingRoom.status === "OPEN" ? new Date(Date.now() + PUBLIC_ROOM_AUTO_START_MS) : null,
    },
    make_private: {
      visibility: "PRIVATE",
      autoStartAt: null,
    },
  };

  const updatedRows = await db
    .update(pvpRooms)
    .set({ ...(patchByAction[parsed.data.action] as Record<string, unknown>), updatedAt: new Date() })
    .where(eq(pvpRooms.id, parsed.data.roomId))
    .returning({
      id: pvpRooms.id,
      code: pvpRooms.code,
      status: pvpRooms.status,
      visibility: pvpRooms.visibility,
      maxPlayers: pvpRooms.maxPlayers,
      expiresAt: pvpRooms.expiresAt,
      autoStartAt: pvpRooms.autoStartAt,
      updatedAt: pvpRooms.updatedAt,
    });

  const updatedRoomBase = updatedRows[0]!;

  const [memberCountRows, matchCountRows] = await Promise.all([
    db.select({ value: count() }).from(pvpRoomMembers).where(eq(pvpRoomMembers.roomId, updatedRoomBase.id)),
    db.select({ value: count() }).from(pvpMatches).where(eq(pvpMatches.roomId, updatedRoomBase.id)),
  ]);

  const updatedRoom = {
    ...updatedRoomBase,
    _count: {
      members: Number(memberCountRows[0]?.value ?? 0),
      matches: Number(matchCountRows[0]?.value ?? 0),
    },
  };

  await createAdminAuditLog({
    actorUserId: adminUserId,
    action: parsed.data.action,
    entityType: "pvp_room",
    entityId: updatedRoom.id,
    targetUserId: existingRoom.hostUserId,
    summary: `Admin ${parsed.data.action} room ${existingRoom.code}`,
    metadata: {
      roomCode: existingRoom.code,
      previousStatus: existingRoom.status,
      previousVisibility: existingRoom.visibility,
      nextStatus: updatedRoom.status,
      nextVisibility: updatedRoom.visibility,
    },
  });

  return NextResponse.json({ updatedBy: adminUserId, room: updatedRoom });
}