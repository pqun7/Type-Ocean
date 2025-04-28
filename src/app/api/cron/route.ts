// api/cron/route.ts
import { NextResponse } from "next/server";
import { cleanupRateLimits } from "@/lib/cleanup-rate-limits";
import { prisma } from "@/lib/db";

// api/cron/route.ts
export async function GET() {
  try {
    await cleanupRateLimits();
    await prisma.$executeRaw`VACUUM FULL;`; // تحسين قاعدة البيانات
    return NextResponse.json({ 
      success: true,
      message: 'Rate limits cleaned successfully'
    });
  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}