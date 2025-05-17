// api/cron/route.ts
import { NextResponse } from "next/server";
import { cleanupRateLimits } from "@/lib/cron/cleanup-rate-limits";
import { cleanupExpiredTokens } from "@/lib/cron/cleanup-tokens";
import prisma from "@/lib/db";

export async function GET() {
  try {
    await cleanupExpiredTokens();
    await cleanupRateLimits();

    await prisma.$executeRaw`VACUUM;`;

    return NextResponse.json({
      success: true,
      message: "Cron jobs executed successfully",
    });
  } catch (error) {
    console.error("Cron job error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
