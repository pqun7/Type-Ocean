export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { pvpRoomMembers, pvpRooms } from "@/db/schema";
import { authorizeRequest } from "@/app/api/shared.server";
import { generateInviteCode } from "@/features/pvp/server/invite-code";
import { incrementSecurityMetric } from "@/lib/security-metrics";
import { rateLimiter } from "@/lib/rate-limiter";

const PUBLIC_ROOM_MAX_PLAYERS = 6;
const PUBLIC_ROOM_AUTO_START_MS = 50_000;

export async function POST(req: NextRequest) {
  const rateLimit = await rateLimiter.applyRateLimit(req, "/api/pvp/rooms/public:POST");
  if (!rateLimit.allowed) {
    incrementSecurityMetric("api_rate_limit_rejected", { route: "/api/pvp/rooms/public", method: "POST" });
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
  }

  const userId = await authorizeRequest(req);
  if (!userId) {
    incrementSecurityMetric("api_auth_rejected", { route: "/api/pvp/rooms/public", method: "POST" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  const now = new Date();
  const existingRoomsRaw = await db
    .select({
      id: pvpRooms.id,
      code: pvpRooms.code,
      maxPlayers: pvpRooms.maxPlayers,
      createdAt: pvpRooms.createdAt,
      memberUserId: pvpRoomMembers.userId,
    })
    .from(pvpRooms)
    .leftJoin(pvpRoomMembers, and(eq(pvpRoomMembers.roomId, pvpRooms.id), isNull(pvpRoomMembers.leftAt)))
    .where(
      and(
        eq(pvpRooms.visibility, "PUBLIC"),
        eq(pvpRooms.status, "OPEN"),
        or(isNull(pvpRooms.expiresAt), gt(pvpRooms.expiresAt, now)),
      ),
    )
    .orderBy(asc(pvpRooms.createdAt))
    .limit(500);

  const roomMap = new Map<
    string,
    { id: string; code: string; maxPlayers: number; createdAt: Date; members: Array<{ userId: string }> }
  >();
  for (const row of existingRoomsRaw) {
    const existing = roomMap.get(row.id) ?? {
      id: row.id,
      code: row.code,
      maxPlayers: row.maxPlayers,
      createdAt: row.createdAt,
      members: [],
    };
    if (row.memberUserId) {
      existing.members.push({ userId: row.memberUserId });
    }
    roomMap.set(row.id, existing);
  }
  const existingRooms = Array.from(roomMap.values()).slice(0, 20);

  const roomToJoin = existingRooms
    .filter((room) => room.members.some((member) => member.userId === userId) || room.members.length < room.maxPlayers)
    .sort((left, right) => {
      const countDelta = right.members.length - left.members.length;
      if (countDelta !== 0) return countDelta;
      return left.createdAt.getTime() - right.createdAt.getTime();
    })[0];

  if (roomToJoin) {
    return NextResponse.json(
      {
        code: roomToJoin.code,
        maxPlayers: roomToJoin.maxPlayers,
        visibility: "PUBLIC",
      },
      { headers: rateLimit.headers }
    );
  }

  let createdRoom: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode(6);
    try {
      createdRoom = await db.transaction(async (tx) => {
        const createdRows = await tx
          .insert(pvpRooms)
          .values({
            code,
            status: "OPEN",
            visibility: "PUBLIC",
            createdByUserId: userId,
            hostUserId: userId,
            minPlayers: 2,
            maxPlayers: PUBLIC_ROOM_MAX_PLAYERS,
            autoStartAt: new Date(Date.now() + PUBLIC_ROOM_AUTO_START_MS),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          })
          .returning({ id: pvpRooms.id, code: pvpRooms.code });

        const created = createdRows[0]!;
        await tx.insert(pvpRoomMembers).values({
          roomId: created.id,
          userId,
          colorSlot: 0,
        });

        return created;
      });
      break;
    } catch {
      // likely invite-code collision; retry
    }
  }

  if (!createdRoom) {
    return NextResponse.json({ error: "Failed to find a public room" }, { status: 500, headers: rateLimit.headers });
  }

  return NextResponse.json(
    {
      roomId: createdRoom.id,
      code: createdRoom.code,
      maxPlayers: PUBLIC_ROOM_MAX_PLAYERS,
      visibility: "PUBLIC",
    },
    { headers: rateLimit.headers }
  );
}