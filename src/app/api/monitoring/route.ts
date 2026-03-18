import { monitoring } from "@/monitoring/monitoringSystem";
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/app/api/shared.server";
import { PerformanceAnalyzer } from "@/monitoring/kpis";
import { logging } from "@/log/ServerLogger";
import { sql } from "drizzle-orm";
import { db } from "@/db";

type PgActivityRow = {
  state: string | null;
  count: number;
};

async function getPgConnectionSnapshot() {
  try {
    const result = await db.execute<PgActivityRow>(sql`
      SELECT state, COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state
    `);

    const rows = (result.rows ?? []) as PgActivityRow[];

    const byState = rows.reduce<Record<string, number>>((acc, row) => {
      const key = row.state ?? "unknown";
      acc[key] = row.count;
      return acc;
    }, {});

    const total = Object.values(byState).reduce((sum: number, value: number) => sum + value, 0);

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

async function getDbMetricsSnapshot() {
  return { available: false, reason: "db_metrics_removed" };
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
    const [pgConnections, dbMetrics] = await Promise.all([
      getPgConnectionSnapshot(),
      getDbMetricsSnapshot(),
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
        dbMetrics,
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