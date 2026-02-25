export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/features/auth/lib/db";
import { authorizeRequest } from "@/app/api/shared.server";
import { generateInviteCode } from "@/features/pvp/server/invite-code";

function safeJson<T>(req: NextRequest): Promise<T | null> {
  return req
    .json()
    .then((v) => v as T)
    .catch(() => null);
}

export async function POST(req: NextRequest) {
  const userId = await authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await safeJson<{ maxPlayers?: number }>(req);
  const maxPlayersRaw = body?.maxPlayers;
  const maxPlayers =
    typeof maxPlayersRaw === "number" && Number.isFinite(maxPlayersRaw)
      ? Math.max(2, Math.min(6, Math.floor(maxPlayersRaw)))
      : 6;

  // Create a unique room code (retry a few times on collision)
  let code = "";
  let roomId: string | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateInviteCode(6);
    try {
      const room = await prisma.pvpRoom.create({
        data: {
          code,
          status: "OPEN",
          createdByUserId: userId,
          minPlayers: 2,
          maxPlayers,
          expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
          members: {
            create: {
              userId,
              colorSlot: 0,
            },
          },
        },
        select: { id: true, code: true },
      });

      roomId = room.id;
      break;
    } catch {
      // likely code collision; retry
    }
  }

  if (!roomId) {
    return NextResponse.json(
      { error: "Failed to create room" },
      { status: 500 }
    );
  }

  return NextResponse.json({ roomId, code, maxPlayers });
}
