export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { enforceRateLimit } from "@/lib/rate-limiter";
import { authorizeRequest } from "@/app/api/shared.server";
import {
  appendOverallKeyboardPerformance,
  getOverallKeyboardPerformance,
} from "@/helper/overall-keyboard-performance";
import { incrementSecurityMetric } from "@/lib/security-metrics";
import { parseJsonBodyWithSchema } from "@/lib/validation/request-body";

const BodySchema = z.object({
  language: z.enum(["en", "ar", "fr", "es"]),
  performanceData: z.record(
    z.string(),
    z
      .object({
        correct: z.number().int().min(0),
        error: z.number().int().min(0),
      })
      .optional()
  ),
});

export async function POST(req: NextRequest) {
  const rateLimit = await enforceRateLimit(req, "session-stats");
  if (rateLimit instanceof NextResponse && rateLimit.status === 429) {
    return rateLimit;
  }

  const userId = await authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBodyWithSchema({
    req,
    schema: BodySchema,
    maxBytes: 1024,
  });
  if (!parsed.success) {
    incrementSecurityMetric("api_validation_failed", { route: "/api/session-stats/v1/keyboard", reason: parsed.error });
    const details = "issues" in parsed ? parsed.issues : undefined;
    return NextResponse.json(
      { error: parsed.error, ...(details ? { details } : {}) },
      { status: 400 }
    );
  }

  const snapshot = await appendOverallKeyboardPerformance(
    userId,
    parsed.data.language,
    parsed.data.performanceData
  );

  return NextResponse.json({
    success: true,
    snapshot: snapshot
      ? {
          sessions: snapshot.sessions,
          lastLanguage: snapshot.lastLanguage,
          updatedAt: snapshot.updatedAt,
        }
      : null,
  });
}

export async function GET(req: NextRequest) {
  const rateLimit = await enforceRateLimit(req, "session-stats");
  if (rateLimit instanceof NextResponse && rateLimit.status === 429) {
    return rateLimit;
  }

  const userId = await authorizeRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getOverallKeyboardPerformance(userId);
  return NextResponse.json({ snapshot }, { headers: { "Cache-Control": "private, no-store" } });
}
