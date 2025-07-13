import { NextRequest, NextResponse } from "next/server";
import redis, { connectIfNeeded } from "@/lib/redis";
import { v4 as uuidv4 } from "uuid";
import {
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";

const SERVICE_TYPE = "HEALTH-CHECK";
const FILE_PATH = "src/app/api/health/route.ts";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  environment: string;
  uptime: number;
  services: {
    redis: {
      status: "connected" | "disconnected" | "error";
      latency?: number;
      error?: string;
    };
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    system: {
      cpu: number;
      loadAverage: number[];
    };
  };
  requestId: string;
}

/**
 * Health check endpoint for monitoring system status
 * Returns comprehensive health information about the application
 */
export async function GET(req: NextRequest) {
  const requestId = uuidv4();
  const startTime = Date.now();

  try {
    logRequestStart(requestId, SERVICE_TYPE, "GET", FILE_PATH);

    // Check Redis connection and latency
    const redisStart = Date.now();
    let redisStatus: HealthStatus["services"]["redis"];

    try {
      await connectIfNeeded();
      await redis.ping();
      const redisLatency = Date.now() - redisStart;

      redisStatus = {
        status: "connected",
        latency: redisLatency,
      };
    } catch (error) {
      redisStatus = {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // Get memory usage
    const memoryUsage = process.memoryUsage();
    const memoryStatus = {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
      percentage: Math.round(
        (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
      ),
    };

    // Get system info
    const systemStatus = {
      cpu: Math.round(process.cpuUsage().user / 1000), // Convert to milliseconds
      loadAverage:
        process.platform === "win32"
          ? [0, 0, 0]
          : require("os").loadavg(),
    };

    // Determine overall health status
    let overallStatus: HealthStatus["status"] = "healthy";

    if (redisStatus.status === "error") {
      overallStatus = "unhealthy";
    } else if (
      redisStatus.status === "disconnected" ||
      memoryStatus.percentage > 85 ||
      (redisStatus.latency && redisStatus.latency > 100)
    ) {
      overallStatus = "degraded";
    }

    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0",
      environment: process.env.NODE_ENV || "development",
      uptime: Math.round(process.uptime()),
      services: {
        redis: redisStatus,
        memory: memoryStatus,
        system: systemStatus,
      },
      requestId,
    };

    const responseTime = Date.now() - startTime;

    logRequestSuccess(requestId, SERVICE_TYPE, "GET", FILE_PATH, {
      healthStatus: overallStatus,
      responseTime,
      redisLatency: redisStatus.latency,
    });

    // Return appropriate HTTP status based on health
    const httpStatus =
      overallStatus === "healthy"
        ? 200
        : overallStatus === "degraded"
        ? 200
        : 503;

    return NextResponse.json(healthStatus, {
      status: httpStatus,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Response-Time": responseTime.toString(),
      },
    });
  } catch (error) {
    logRequestError(requestId, SERVICE_TYPE, error, FILE_PATH, {
      operationPhase: "health_check",
    });

    const errorResponse: Partial<HealthStatus> = {
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      requestId,
    };

    return NextResponse.json(errorResponse, { status: 503 });
  }
}

/**
 * HEAD - Quick health check without body
 */
export async function HEAD(req: NextRequest) {
  const requestId = uuidv4();

  try {
    await connectIfNeeded();
    await redis.ping();

    return new NextResponse(null, {
      status: 200,
      headers: {
        "X-Health-Status": "healthy",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return new NextResponse(null, {
      status: 503,
      headers: {
        "X-Health-Status": "unhealthy",
        "X-Request-Id": requestId,
      },
    });
  }
}