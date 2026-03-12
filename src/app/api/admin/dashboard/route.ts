export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/features/auth/lib/db";
import { authorizeAdminActor } from "@/app/api/shared.server";
import { monitoring } from "@/monitoring/monitoringSystem";
import { PerformanceAnalyzer } from "@/monitoring/kpis";
import { connectIfNeeded, redis } from "@/lib/redis";

const ONLINE_KEY_PREFIX = "pvp:online:";

async function scanOnlineUserIds(limit = 50) {
  const collected = new Set<string>();
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${ONLINE_KEY_PREFIX}*`, "COUNT", 100);
    cursor = nextCursor;

    for (const key of keys) {
      collected.add(key.slice(ONLINE_KEY_PREFIX.length));
      if (collected.size >= limit) {
        return Array.from(collected);
      }
    }
  } while (cursor !== "0");

  return Array.from(collected);
}

function buildWarnings(params: {
  pendingFlags: number;
  sanctionCandidates: number;
  topErrors: Array<[string, number]>;
  avgResponseTime: number | null;
  redisHealthy: boolean;
}) {
  const warnings: string[] = [];

  if (!params.redisHealthy) {
    warnings.push("Redis is unavailable. Caching, notices, and some rate-limit paths may degrade.");
  }

  if (params.pendingFlags > 0) {
    warnings.push(`${params.pendingFlags} cheat flags are still awaiting admin review.`);
  }

  if (params.sanctionCandidates > 0) {
    warnings.push(`${params.sanctionCandidates} flagged cases crossed the sanction threshold.`);
  }

  if (params.topErrors.length > 0) {
    warnings.push(`Recent API errors detected. Top error: ${params.topErrors[0]?.[0]}.`);
  }

  if (params.avgResponseTime !== null && params.avgResponseTime > 1500) {
    warnings.push(`Average API response time is elevated at ${Math.round(params.avgResponseTime)}ms.`);
  }

  return warnings;
}

export async function GET(req: NextRequest) {
  const adminActor = await authorizeAdminActor(req);
  if (!adminActor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let redisHealthy = false;
  let activePlayerIds: string[] = [];

  try {
    await connectIfNeeded();
    redisHealthy = (await redis.ping()) === "PONG";
    if (redisHealthy) {
      activePlayerIds = await scanOnlineUserIds(50);
    }
  } catch {
    redisHealthy = false;
  }

  const [
    totalUsers,
    bannedUsers,
    adminUsers,
    pendingFlags,
    sanctionCandidates,
    recentFlags,
    recentUsers,
    recentRooms,
    recentAdminActions,
    adminAccounts,
    recentFeedback,
    openFeedbackCount,
    activePlayers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { banned: true } }),
    prisma.user.count({ where: { role: "admin" } }),
    prisma.cheatFlag.count({ where: { reviewed: false } }),
    prisma.cheatFlag.count({ where: { wouldSanction: true, reviewed: false } }),
    prisma.cheatFlag.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        user: { select: { id: true, username: true, role: true, banned: true } },
        match: { select: { id: true, status: true, createdAt: true } },
      },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        banned: true,
        isPrimaryAdmin: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.pvpRoom.findMany({
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        id: true,
        code: true,
        status: true,
        visibility: true,
        maxPlayers: true,
        hostUserId: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
        _count: { select: { members: true, matches: true } },
      },
    }),
    prisma.adminActionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        targetUserId: true,
        summary: true,
        createdAt: true,
        actorUser: { select: { id: true, username: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: "admin" },
      orderBy: [{ isPrimaryAdmin: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        username: true,
        email: true,
        banned: true,
        isPrimaryAdmin: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.userFeedback.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        category: true,
        status: true,
        subject: true,
        body: true,
        rating: true,
        imageUrl: true,
        adminReplyTitle: true,
        adminReplyBody: true,
        respondedAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        respondedBy: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    }),
    prisma.userFeedback.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    activePlayerIds.length === 0
      ? Promise.resolve([])
      : prisma.user.findMany({
          where: { id: { in: activePlayerIds } },
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            banned: true,
            isPrimaryAdmin: true,
            image: true,
            profile: { select: { avatar: true } },
          },
        }).then((users) => {
          const order = new Map(activePlayerIds.map((id, index) => [id, index]));
          return users.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
        }),
  ]);

  const report = monitoring.getPerformanceReport();
  const apiMetrics = report.apiMetrics;
  const hasMetrics = apiMetrics.length > 0;
  const stats = hasMetrics
    ? PerformanceAnalyzer.calculateStats(apiMetrics)
    : { avgResponseTime: null, successRate: null, topErrors: [] as Array<[string, number]> };

  const warnings = buildWarnings({
    pendingFlags,
    sanctionCandidates,
    topErrors: stats.topErrors,
    avgResponseTime: stats.avgResponseTime,
    redisHealthy,
  });

  const notes = [
    process.env.NODE_ENV === "production"
      ? "Interactive diagnostics are hidden in production. Read-only status is still available below."
      : "Interactive diagnostics are enabled in development for admin users only.",
    "Admin notices are delivered through Redis and shown to the user in a blocking dialog until dismissed.",
  ];

  const normalizedActivePlayers = activePlayers.map((player) => ({
    id: player.id,
    username: player.username,
    email: player.email,
    role: player.role,
    banned: player.banned,
    isPrimaryAdmin: player.isPrimaryAdmin,
    avatar: player.profile?.avatar ?? player.image,
  }));

  return NextResponse.json({
    requestedBy: adminActor.id,
    currentAdmin: {
      id: adminActor.id,
      username: adminActor.username,
      email: adminActor.email,
      isPrimaryAdmin: adminActor.isPrimaryAdmin,
    },
    environment: {
      nodeEnv: process.env.NODE_ENV,
      isProduction: process.env.NODE_ENV === "production",
    },
    overview: {
      totalUsers,
      bannedUsers,
      adminUsers,
      pendingFlags,
      sanctionCandidates,
      redisHealthy,
      activePlayers: normalizedActivePlayers.length,
      openFeedbackCount,
      apiMetricCount: apiMetrics.length,
      avgResponseTime: stats.avgResponseTime,
      successRate: stats.successRate,
      topErrors: stats.topErrors.slice(0, 5),
    },
    warnings,
    notes,
    recentFlags,
    recentUsers,
    recentRooms,
    recentAdminActions,
    adminAccounts,
    activePlayers: normalizedActivePlayers,
    recentFeedback,
  });
}