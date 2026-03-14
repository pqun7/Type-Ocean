export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { authorizeRequest } from "@/app/api/shared.server";
import { rateLimiter } from "@/lib/rate-limiter";
import { logging } from "@/log/ServerLogger";
import { addUserXP, getUserProgress } from "@/features/level/server-utils/userCache";
import {
  isPrismaAccountHoldError,
  isPrismaTemporarilyUnavailableError,
} from "@/lib/prisma-error-utils";

const SERVICE_TYPE = "PROFILE-PROGRESS";

const BonusMetaSchema = z.object({
  isMythicClaim:  z.boolean().optional(),
  isPBClaim:      z.boolean().optional(),
  claimedWpm:     z.number().min(0).max(500).optional(),
  mythicBonusXp:  z.number().int().min(0).max(600).optional(),
}).optional();

const BodySchema = z.object({
  xpDelta:   z.number().int().positive().max(5000),
  bonusMeta: BonusMetaSchema,
});

function validateCSRF(req: NextRequest): string | null {
  const origin = req.headers.get("origin") || "";
  const referer = req.headers.get("referer") || "";
  const host = new URL(req.url).origin;

  if (origin && origin !== host) return "Invalid origin";
  if (referer && !referer.startsWith(host)) return "Invalid referer";
  return null;
}

export async function GET(req: NextRequest) {
  const requestId = uuidv4();
  const endpoint = "/api/profile/progress";

  const rl = await rateLimiter.applyRateLimit(req, `${endpoint}:GET`);
  if (!rl.allowed) {
    const headers = new Headers(rl.headers);
    headers.set("Cache-Control", "private, no-store");
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
  }

  try {
    const userId = await authorizeRequest(req);
    if (!userId) {
      return NextResponse.json(
        { valid: false, reason: "not_authenticated" },
        { status: 200, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const progress = await getUserProgress(userId);
    return NextResponse.json(
      { valid: true, progress },
      {
        // Progress is user-specific and must not be reused across account switches.
        // Browsers can cache private responses by URL, which can lead to showing a previous user's data.
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  } catch (error) {
    if (isPrismaAccountHoldError(error)) {
      return NextResponse.json(
        {
          error: "Progress is temporarily unavailable due to a database account hold",
          code: "DB_ACCOUNT_HOLD",
        },
        {
          status: 503,
          headers: {
            "Retry-After": "120",
            "Cache-Control": "private, no-store",
          },
        }
      );
    }

    if (isPrismaTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        {
          error: "Progress is temporarily unavailable",
          code: "DB_TEMP_UNAVAILABLE",
        },
        {
          status: 503,
          headers: {
            "Retry-After": "60",
            "Cache-Control": "private, no-store",
          },
        }
      );
    }

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
    const userId = await authorizeRequest(req);
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

    const { xpDelta: rawXpDelta, bonusMeta } = parsed.data;
    let xpDelta = rawXpDelta;

    // Conditional server-side validation for mythic/PB claims.
    // Only triggers when the client asserts a PB or mythic bonus — normal sessions bypass this
    // entirely (no extra Redis round-trip for the 99% case).
    if (bonusMeta && (bonusMeta.isMythicClaim || bonusMeta.isPBClaim)) {
      try {
        const progress = await getUserProgress(userId);
        const progressRecord = progress as Record<string, unknown>;
        const serverBestWPM: number = typeof progressRecord.bestWPM === "number"
          ? progressRecord.bestWPM
          : 0;

        const claimedWpm = bonusMeta.claimedWpm ?? 0;
        const mythicXp   = bonusMeta.mythicBonusXp ?? 0;

        // If the claimed WPM doesn’t actually beat the server record, strip the bonus XP
        if (bonusMeta.isPBClaim && claimedWpm <= serverBestWPM && mythicXp > 0) {
          xpDelta = Math.max(1, xpDelta - mythicXp);
          logging.warn("PB claim rejected — claimedWpm does not exceed serverBestWPM", {
            requestId,
            service: SERVICE_TYPE,
            endpoint,
            userId,
            claimedWpm,
            serverBestWPM,
            strippedXp: mythicXp,
          });
        }
      } catch (validationError) {
        // Non-fatal: if validation fetch fails, allow the XP through rather than blocking the user
        logging.warn("Bonus validation fetch failed — allowing XP", {
          requestId,
          service: SERVICE_TYPE,
          userId,
          error: validationError instanceof Error ? validationError.message : String(validationError),
        });
      }
    }

    const updated = await addUserXP(userId, xpDelta);

    return NextResponse.json({
      success: true,
      progress: updated,
    });
  } catch (error) {
    if (isPrismaAccountHoldError(error)) {
      return NextResponse.json(
        {
          error: "Progress update is temporarily unavailable due to a database account hold",
          code: "DB_ACCOUNT_HOLD",
        },
        {
          status: 503,
          headers: {
            "Retry-After": "120",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    if (isPrismaTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        {
          error: "Progress update is temporarily unavailable",
          code: "DB_TEMP_UNAVAILABLE",
        },
        {
          status: 503,
          headers: {
            "Retry-After": "60",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    logging.error("Profile progress update failed", error, {
      requestId,
      service: SERVICE_TYPE,
      endpoint,
    });
    return NextResponse.json({ error: "Failed to update progress" }, { status: 500 });
  }
}
