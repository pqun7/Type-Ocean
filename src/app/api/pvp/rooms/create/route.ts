export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { pvpRoomMembers, pvpRooms } from "@/db/schema";
import { authorizeRequest } from "@/app/api/shared.server";
import { generateInviteCode } from "@/features/pvp/server/invite-code";
import { incrementSecurityMetric } from "@/lib/security-metrics";
import { rateLimiter } from "@/lib/rate-limiter";
import { PvpRoomCreateBodySchema, type PvpRoomCreateBody } from "@/lib/validation/pvp-api-schemas";

async function safeJson<T>(req: NextRequest): Promise<T | null> {
  const raw = await req.text().catch(() => null);
  if (raw == null) return null;
  if (raw.length === 0) return {} as T;
  if (Buffer.byteLength(raw, "utf8") > 1024) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const rateLimit = await rateLimiter.applyRateLimit(req, "/api/pvp/rooms/create:POST");
  if (!rateLimit.allowed) {
    incrementSecurityMetric("api_rate_limit_rejected", { route: "/api/pvp/rooms/create", method: "POST" });
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
  }

  const userId = await authorizeRequest(req);
  if (!userId) {
    incrementSecurityMetric("api_auth_rejected", { route: "/api/pvp/rooms/create", method: "POST" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  const body = await safeJson<PvpRoomCreateBody>(req);
  if (body === null) {
    incrementSecurityMetric("api_validation_failed", { route: "/api/pvp/rooms/create", reason: "json_body" });
    return NextResponse.json({ error: "Invalid room configuration" }, { status: 400, headers: rateLimit.headers });
  }

  const parsedBody = PvpRoomCreateBodySchema.safeParse(body);
  if (!parsedBody.success) {
    incrementSecurityMetric("api_validation_failed", { route: "/api/pvp/rooms/create", reason: "body" });
    return NextResponse.json({ error: "Invalid room configuration" }, { status: 400, headers: rateLimit.headers });
  }

  const maxPlayers = parsedBody.data.maxPlayers ?? 6;

  // Create a unique room code (retry a few times on collision)
  let code = "";
  let roomId: string | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateInviteCode(6);
    try {
      const createdRows = await db
        .insert(pvpRooms)
        .values({
          code,
          status: "OPEN",
          visibility: "PRIVATE",
          createdByUserId: userId,
          hostUserId: userId,
          minPlayers: 2,
          maxPlayers,
          autoStartAt: null,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .returning({ id: pvpRooms.id, code: pvpRooms.code });

      const created = createdRows[0]!;
      await db.insert(pvpRoomMembers).values({
        roomId: created.id,
        userId,
        colorSlot: 0,
      });

      roomId = created.id;
      break;
    } catch (err: unknown) {
      // Only silently retry on unique constraint collision (code duplicate)
      const msg = err instanceof Error ? err.message : String(err);
      const isCollision =
        msg.includes("unique") || msg.includes("duplicate") || msg.includes("23505");
      if (!isCollision) {
        console.error("[pvp/rooms/create] DB error (non-collision):", err);
        return NextResponse.json(
          { error: "Failed to create room" },
          { status: 500, headers: rateLimit.headers }
        );
      }
    }
  }

  if (!roomId) {
    return NextResponse.json(
      { error: "Failed to create room" },
      { status: 500, headers: rateLimit.headers }
    );
  }

  return NextResponse.json({ roomId, code, maxPlayers }, { headers: rateLimit.headers });
}
