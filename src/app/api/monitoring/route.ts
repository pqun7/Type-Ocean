import { monitoring } from "@/monitoring/monitoringSystem";
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/app/api/shared.server";
import { PerformanceAnalyzer } from "@/monitoring/kpis";
import { logging } from "@/log/ServerLogger";
import prisma from "@/features/auth/lib/db";

type PgActivityRow = {
  state: string | null;
  count: bigint;
};

async function getPgConnectionSnapshot() {
  try {
    const rows = await prisma.$queryRaw<PgActivityRow[]>`
      SELECT state, COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state
    `;

    const byState = rows.reduce<Record<string, number>>((acc, row) => {
      const key = row.state ?? "unknown";
      acc[key] = Number(row.count);
      return acc;
    }, {});

    const total = Object.values(byState).reduce((sum, value) => sum + value, 0);

    return {
      available: true,
      total,
      byState,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getPrismaMetricsSnapshot() {
  try {
    const metricsApi = (prisma as unknown as {
      $metrics?: {
        json?: () => Promise<unknown>;
      };
    }).$metrics;

    if (!metricsApi?.json) {
      return { available: false, reason: "metrics_api_unavailable" };
    }

    const payload = await metricsApi.json();
    return { available: true, payload };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET(req: NextRequest) {
  const adminUserId = await authorizeAdminRequest(req);
  if (!adminUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestId = `monitoring-${Date.now()}`;
  
  try {
    logging.debugSensitive("Monitoring report generation started", {
      requestId,
      operation: "performance_report"
    });

    const metrics = monitoring.getPerformanceReport();
    const stats = PerformanceAnalyzer.calculateStats(metrics.apiMetrics);
    const [pgConnections, prismaMetrics] = await Promise.all([
      getPgConnectionSnapshot(),
      getPrismaMetricsSnapshot(),
    ]);
    
    logging.info('Generated Performance Report', {
      requestId,
      reportStats: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage().rss,
        apiRequests: metrics.apiMetrics.length,
        challengesGenerated: metrics.challengeMetrics.length
      }
    });

    // Log detailed metrics only in development
    logging.debugSensitive("Performance metrics details", {
      requestId,
    });
  
    return NextResponse.json({
      metrics,
      stats,
      requestedBy: adminUserId,
      db: {
        pgConnections,
        prismaMetrics,
      },
    });
  } catch (error) {
    logging.error("Monitoring report generation failed", error, {
      requestId,
      operation: "performance_report"
    });
    
    return NextResponse.json(
      { error: "Failed to generate monitoring report" },
      { status: 500 }
    );
  }
}