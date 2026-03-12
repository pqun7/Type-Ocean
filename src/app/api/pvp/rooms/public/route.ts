export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/features/auth/lib/db";
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
  const existingRooms = await prisma.pvpRoom.findMany({
    where: {
      visibility: "PUBLIC",
      status: "OPEN",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      id: true,
      code: true,
      maxPlayers: true,
      createdAt: true,
      members: {
        where: { leftAt: null },
        select: { userId: true },
      },
    },
  });

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
      createdRoom = await prisma.pvpRoom.create({
        data: {
          code,
          status: "OPEN",
          visibility: "PUBLIC",
          createdByUserId: userId,
          hostUserId: userId,
          minPlayers: 2,
          maxPlayers: PUBLIC_ROOM_MAX_PLAYERS,
          autoStartAt: new Date(Date.now() + PUBLIC_ROOM_AUTO_START_MS),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          members: {
            create: {
              userId,
              colorSlot: 0,
            },
          },
        },
        select: { id: true, code: true },
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