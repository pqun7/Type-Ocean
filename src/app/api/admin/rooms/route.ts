export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import prisma from "@/features/auth/lib/db";
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

  const existingRoom = await prisma.pvpRoom.findUnique({
    where: { id: parsed.data.roomId },
    select: {
      id: true,
      code: true,
      status: true,
      visibility: true,
      hostUserId: true,
    },
  });

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

  const updatedRoom = await prisma.pvpRoom.update({
    where: { id: parsed.data.roomId },
    data: patchByAction[parsed.data.action],
    select: {
      id: true,
      code: true,
      status: true,
      visibility: true,
      maxPlayers: true,
      expiresAt: true,
      autoStartAt: true,
      updatedAt: true,
      _count: { select: { members: true, matches: true } },
    },
  });

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