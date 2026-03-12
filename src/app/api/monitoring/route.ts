import { monitoring } from "@/monitoring/monitoringSystem";
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest } from "@/app/api/shared.server";
import { PerformanceAnalyzer } from "@/monitoring/kpis";
import { logging } from "@/log/ServerLogger";

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
  
    return NextResponse.json({ metrics, stats, requestedBy: adminUserId });
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