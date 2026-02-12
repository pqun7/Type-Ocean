export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getToken } from "next-auth/jwt";

import { rateLimiter } from "@/lib/rate-limiter";

function nowMs(): number {
  const p = (globalThis as unknown as { performance?: { now: () => number } }).performance;
  return typeof p?.now === "function" ? p.now() : Date.now();
}

function buildServerTiming(timing: Record<string, number | undefined>): string {
  return Object.entries(timing)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .map(([k, v]) => `${k};dur=${Math.round(v as number)}`)
    .join(", ");
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
  const endpoint = "/api/home/auth";
  const startedAt = nowMs();

  const timing: Record<string, number | undefined> = {
    rateLimit: undefined,
    token: undefined,
    total: undefined,
  };

  // Run rate limit + token parsing concurrently (independent operations).
  const rlStart = nowMs();
  const tokenStart = nowMs();
  const [rl, userId] = await Promise.all([
    rateLimiter.applyRateLimit(req, `${endpoint}:GET`),
    getUserIdFromRequest(req),
  ]);
  timing.rateLimit = nowMs() - rlStart;
  timing.token = nowMs() - tokenStart;

  if (!rl.allowed) {
    timing.total = nowMs() - startedAt;
    const headers = new Headers(rl.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Request-Id", requestId);
    headers.set("Server-Timing", buildServerTiming(timing));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
  }

  timing.total = nowMs() - startedAt;

  return NextResponse.json(
    userId
      ? { valid: true, userId }
      : { valid: false, reason: "not_authenticated" },
    {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
        "Server-Timing": buildServerTiming(timing),
      },
    }
  );
}
