export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { getToken } from "next-auth/jwt";

import { rateLimiter } from "@/lib/rate-limiter";
import { logging } from "@/log/ServerLogger";
import { addUserXP, getUserProgress } from "@/features/level/server-utils/userCache";

const SERVICE_TYPE = "PROFILE-PROGRESS";

const BodySchema = z.object({
  xpDelta: z.number().int().positive().max(5000),
});

function validateCSRF(req: NextRequest): string | null {
  const origin = req.headers.get("origin") || "";
  const referer = req.headers.get("referer") || "";
  const host = new URL(req.url).origin;

  if (origin && origin !== host) return "Invalid origin";
  if (referer && !referer.startsWith(host)) return "Invalid referer";
  return null;
}

async function getUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  });

  const userId = (token?.id as string | undefined) ?? token?.sub;
  return userId ?? null;
}

export async function GET(req: NextRequest) {
  const requestId = uuidv4();
  const endpoint = "/api/profile/progress";

  const rl = await rateLimiter.applyRateLimit(req, `${endpoint}:GET`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rl.headers });
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json({ valid: false, reason: "not_authenticated" }, { status: 200 });
    }

    const progress = await getUserProgress(userId);
    return NextResponse.json({ valid: true, progress }, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=30" },
    });
  } catch (error) {
    logging.error("Profile progress fetch failed", error, {
      requestId,
      service: SERVICE_TYPE,
      endpoint,
    });
    return NextResponse.json({ error: "Failed to fetch progress" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const requestId = uuidv4();
  const endpoint = "/api/profile/progress";

  const rl = await rateLimiter.applyRateLimit(req, `${endpoint}:POST`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rl.headers });
  }

  const csrfError = validateCSRF(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 });
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      logging.warn("Invalid JSON body", {
        requestId,
        service: SERVICE_TYPE,
        endpoint,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { xpDelta } = parsed.data;

    const updated = await addUserXP(userId, xpDelta);

    return NextResponse.json({
      success: true,
      progress: updated,
    });
  } catch (error) {
    logging.error("Profile progress update failed", error, {
      requestId,
      service: SERVICE_TYPE,
      endpoint,
    });
    return NextResponse.json({ error: "Failed to update progress" }, { status: 500 });
  }
}
