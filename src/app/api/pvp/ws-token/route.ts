export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/features/auth/lib/db";
import { authorizeRequest } from "@/app/api/shared.server";
import { mintPvpWsToken } from "@/features/pvp/server/ws-token";

export async function GET(req: NextRequest) {
  const userId = await authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      profile: { select: { avatar: true } },
    },
  });

  const pvpRating = await prisma.pvpRating.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { rating: true, deviation: true },
  });

  const { token, expiresAt } = await mintPvpWsToken(
    {
      sub: userId,
      username: user?.username ?? "user",
      avatar: user?.profile?.avatar ?? null,
      pvpRating: pvpRating.rating,
      pvpDeviation: pvpRating.deviation,
    },
    120
  );

  const wsUrl = process.env.NEXT_PUBLIC_PVP_WS_URL ?? null;

  return NextResponse.json({ token, expiresAt, wsUrl });
}
