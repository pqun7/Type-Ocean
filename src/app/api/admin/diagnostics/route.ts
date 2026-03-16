export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { authorizeAdminRequest } from "@/app/api/shared.server";
import { connectIfNeeded, redis } from "@/lib/redis";
import { monitoring } from "@/monitoring/monitoringSystem";
import { sql } from "drizzle-orm";

async function runDiagnostics() {
  const startedAt = Date.now();

  let databaseOk = false;
  let redisOk = false;

  try {
    await db.execute(sql`SELECT "id" FROM "User" LIMIT 1`);
    databaseOk = true;
  } catch {
    databaseOk = false;
  }

  try {
    await connectIfNeeded();
    redisOk = (await redis.ping()) === "PONG";
  } catch {
    redisOk = false;
  }

  const report = monitoring.getPerformanceReport();

  return {
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    environment: process.env.NODE_ENV,
    databaseOk,
    redisOk,
    authSecretConfigured: Boolean(process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET),
    jwtSecretConfigured: Boolean(process.env.JWT_SECRET),
    apiMetricCount: report.apiMetrics.length,
    challengeMetricCount: report.challengeMetrics.length,
  };
}

export async function GET(req: NextRequest) {
  const adminUserId = await authorizeAdminRequest(req);
  if (!adminUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const diagnostics = await runDiagnostics();
  return NextResponse.json({ requestedBy: adminUserId, diagnostics, interactive: process.env.NODE_ENV !== "production" });
}

export async function POST(req: NextRequest) {
  const adminUserId = await authorizeAdminRequest(req);
  if (!adminUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Interactive diagnostics are disabled in production" }, { status: 403 });
  }

  const diagnostics = await runDiagnostics();
  return NextResponse.json({ requestedBy: adminUserId, diagnostics, interactive: true });
}