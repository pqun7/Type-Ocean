// src/app/api/monitoring/route.ts
import { monitoring } from "@/monitoring/monitoringSystem";
import { NextResponse } from "next/server";
import { PerformanceAnalyzer } from "@/monitoring/kpis";
import { logging } from "@/log/ServerLogger";

// src/app/api/monitoring/route.ts
export async function GET() {
    const metrics = monitoring.getPerformanceReport();
    const stats = PerformanceAnalyzer.calculateStats(metrics.apiMetrics);
    
    logging.info('Generated Performance Report', {
      reportStats: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage().rss,
        apiRequests: metrics.apiMetrics.length,
        challengesGenerated: metrics.challengeMetrics.length
      }
    });
  
    return NextResponse.json({ metrics, stats });
  }