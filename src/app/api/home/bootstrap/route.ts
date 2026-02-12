export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getToken } from "next-auth/jwt";

import { rateLimiter } from "@/lib/rate-limiter";
import { logging } from "@/log/ServerLogger";
import { getUserProgress } from "@/features/level/server-utils/userCache";
import { getOrCreateDailyChallenge } from "@/features/level/server-utils/dailyChallengeCache";
import { getDailyChallengeStreak } from "@/features/level/server-utils/dailyChallengeStreak";

const SERVICE = "HOME-BOOTSTRAP";

function nowMs(): number {
  const p = (globalThis as unknown as { performance?: { now: () => number } }).performance;
  return typeof p?.now === "function" ? p.now() : Date.now();
}

function buildServerTiming(timing: Record<string, number | undefined>): string {
  const entries = Object.entries(timing)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .map(([k, v]) => `${k};dur=${Math.round(v as number)}`);

  return entries.join(", ");
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
  const endpoint = "/api/home/bootstrap";
  const startedAt = nowMs();

  const timing: Record<string, number | undefined> = {
    rateLimit: undefined,
    token: undefined,
    progress: undefined,
    dailyChallenge: undefined,
    streak: undefined,
    total: undefined,
  };

  try {
    // Run rate limit + token parsing concurrently (these are independent and often dominate total time).
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

    if (!userId) {
      timing.total = nowMs() - startedAt;
      const headers = {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
        "Server-Timing": buildServerTiming(timing),
      };

      return NextResponse.json({ valid: false, reason: "not_authenticated" }, { status: 200, headers });
    }

    const progressPromise = (async () => {
      const start = nowMs();
      const progress = await getUserProgress(userId);
      timing.progress = nowMs() - start;
      return progress;
    })();

    const challengePromise = (async () => {
      const start = nowMs();
      const dailyChallenge = await getOrCreateDailyChallenge(userId);
      timing.dailyChallenge = nowMs() - start;
      return dailyChallenge;
    })();

    const streakPromise = (async () => {
      const start = nowMs();
      const streakState = await getDailyChallengeStreak(userId);
      timing.streak = nowMs() - start;
      return streakState?.streak ?? 0;
    })();

    const [progress, dailyChallengeRaw, dailyChallengeStreak] = await Promise.all([
      progressPromise,
      challengePromise,
      streakPromise,
    ]);

    // Stamp streak into challenge.data for UI convenience (does not affect validation/progress).
    const dailyChallenge = dailyChallengeRaw
      ? {
          ...dailyChallengeRaw,
          data: {
            ...(dailyChallengeRaw.data ?? {}),
            streak: dailyChallengeStreak,
          },
        }
      : dailyChallengeRaw;

    timing.total = nowMs() - startedAt;

    // Opt-in timing logs (console logging can be surprisingly expensive during dev).
    if (process.env.DEBUG_BOOTSTRAP_TIMINGS === "true") {
      logging.debugSensitive("Home bootstrap timings", {
        requestId,
        endpoint,
        userId,
        rateLimitMs: Math.round(timing.rateLimit ?? 0),
        tokenMs: Math.round(timing.token ?? 0),
        progressMs: Math.round(timing.progress ?? 0),
        dailyChallengeMs: Math.round(timing.dailyChallenge ?? 0),
        totalMs: Math.round(timing.total ?? 0),
      });
    }

    return NextResponse.json(
      {
        valid: true,
        userId,
        progress,
        dailyChallenge,
        dailyChallengeStreak,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-Id": requestId,
          "Server-Timing": buildServerTiming(timing),
        },
      }
    );
  } catch (error) {
    timing.total = nowMs() - startedAt;

    logging.error("Bootstrap fetch failed", error, {
      requestId,
      service: SERVICE,
      endpoint,
    });

    return NextResponse.json(
      { valid: false, reason: "server_error" },
      {
        status: 500,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-Id": requestId,
          "Server-Timing": buildServerTiming(timing),
        },
      }
    );
  }
}
