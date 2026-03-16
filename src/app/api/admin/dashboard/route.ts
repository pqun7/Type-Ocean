export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  adminActionLogs,
  cheatFlags,
  pvpMatches,
  playerProfiles,
  pvpRoomMembers,
  pvpRooms,
  userFeedback,
  users,
} from "@/db/schema";
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
    totalUsersRows,
    bannedUsersRows,
    adminUsersRows,
    pendingFlagsRows,
    sanctionCandidatesRows,
    recentFlagsRows,
    recentUsers,
    recentRoomsRaw,
    recentAdminActionsRows,
    adminAccounts,
    recentFeedbackRows,
    openFeedbackCountRows,
    activePlayersRaw,
  ] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(users).where(eq(users.banned, true)),
    db.select({ value: count() }).from(users).where(eq(users.role, "admin")),
    db.select({ value: count() }).from(cheatFlags).where(eq(cheatFlags.reviewed, false)),
    db
      .select({ value: count() })
      .from(cheatFlags)
      .where(and(eq(cheatFlags.wouldSanction, true), eq(cheatFlags.reviewed, false))),
    db
      .select({
        id: cheatFlags.id,
        userId: cheatFlags.userId,
        matchId: cheatFlags.matchId,
        confidence: cheatFlags.confidence,
        flags: cheatFlags.flags,
        reviewed: cheatFlags.reviewed,
        wouldSanction: cheatFlags.wouldSanction,
        metadata: cheatFlags.metadata,
        createdAt: cheatFlags.createdAt,
        updatedAt: cheatFlags.updatedAt,
        username: users.username,
        role: users.role,
        banned: users.banned,
        matchStatus: pvpMatches.status,
        matchCreatedAt: pvpMatches.createdAt,
      })
      .from(cheatFlags)
      .innerJoin(users, eq(cheatFlags.userId, users.id))
      .innerJoin(pvpMatches, eq(cheatFlags.matchId, pvpMatches.id))
      .orderBy(desc(cheatFlags.createdAt))
      .limit(12),
    db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        banned: users.banned,
        isPrimaryAdmin: users.isPrimaryAdmin,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(20),
    db
      .select({
        id: pvpRooms.id,
        code: pvpRooms.code,
        status: pvpRooms.status,
        visibility: pvpRooms.visibility,
        maxPlayers: pvpRooms.maxPlayers,
        hostUserId: pvpRooms.hostUserId,
        createdAt: pvpRooms.createdAt,
        updatedAt: pvpRooms.updatedAt,
        expiresAt: pvpRooms.expiresAt,
      })
      .from(pvpRooms)
      .orderBy(desc(pvpRooms.updatedAt))
      .limit(12),
    db
      .select({
        id: adminActionLogs.id,
        action: adminActionLogs.action,
        entityType: adminActionLogs.entityType,
        entityId: adminActionLogs.entityId,
        targetUserId: adminActionLogs.targetUserId,
        summary: adminActionLogs.summary,
        createdAt: adminActionLogs.createdAt,
        actorUserId: users.id,
        actorUsername: users.username,
      })
      .from(adminActionLogs)
      .innerJoin(users, eq(adminActionLogs.actorUserId, users.id))
      .orderBy(desc(adminActionLogs.createdAt))
      .limit(20),
    db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        banned: users.banned,
        isPrimaryAdmin: users.isPrimaryAdmin,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.role, "admin"))
      .orderBy(desc(users.isPrimaryAdmin), asc(users.createdAt)),
    db
      .select({
        id: userFeedback.id,
        category: userFeedback.category,
        status: userFeedback.status,
        subject: userFeedback.subject,
        body: userFeedback.body,
        rating: userFeedback.rating,
        imageUrl: userFeedback.imageUrl,
        adminReplyTitle: userFeedback.adminReplyTitle,
        adminReplyBody: userFeedback.adminReplyBody,
        respondedAt: userFeedback.respondedAt,
        createdAt: userFeedback.createdAt,
        userId: users.id,
        username: users.username,
        email: users.email,
        respondedByUserId: userFeedback.respondedByUserId,
      })
      .from(userFeedback)
      .innerJoin(users, eq(userFeedback.userId, users.id))
      .orderBy(desc(userFeedback.createdAt))
      .limit(20),
    db
      .select({ value: count() })
      .from(userFeedback)
      .where(inArray(userFeedback.status, ["OPEN", "IN_REVIEW"])),
    activePlayerIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: users.id,
            username: users.username,
            email: users.email,
            role: users.role,
            banned: users.banned,
            isPrimaryAdmin: users.isPrimaryAdmin,
            image: users.image,
            avatar: playerProfiles.avatar,
          })
          .from(users)
          .leftJoin(playerProfiles, eq(users.id, playerProfiles.userId))
          .where(inArray(users.id, activePlayerIds)),
  ]);

  const totalUsers = Number(totalUsersRows[0]?.value ?? 0);
  const bannedUsers = Number(bannedUsersRows[0]?.value ?? 0);
  const adminUsers = Number(adminUsersRows[0]?.value ?? 0);
  const pendingFlags = Number(pendingFlagsRows[0]?.value ?? 0);
  const sanctionCandidates = Number(sanctionCandidatesRows[0]?.value ?? 0);
  const openFeedbackCount = Number(openFeedbackCountRows[0]?.value ?? 0);

  const recentFlags = recentFlagsRows.map((row) => ({
    id: row.id,
    userId: row.userId,
    matchId: row.matchId,
    confidence: row.confidence,
    flags: row.flags,
    reviewed: row.reviewed,
    wouldSanction: row.wouldSanction,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: { id: row.userId, username: row.username, role: row.role, banned: row.banned },
    match: { id: row.matchId, status: row.matchStatus, createdAt: row.matchCreatedAt },
  }));

  const recentRoomCounts = await Promise.all(
    recentRoomsRaw.map(async (room) => {
      const [memberRows, matchRows] = await Promise.all([
        db.select({ value: count() }).from(pvpRoomMembers).where(eq(pvpRoomMembers.roomId, room.id)),
        db.select({ value: count() }).from(pvpMatches).where(eq(pvpMatches.roomId, room.id)),
      ]);

      return {
        ...room,
        _count: {
          members: Number(memberRows[0]?.value ?? 0),
          matches: Number(matchRows[0]?.value ?? 0),
        },
      };
    }),
  );
  const recentRooms = recentRoomCounts;

  const recentAdminActions = recentAdminActionsRows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    targetUserId: row.targetUserId,
    summary: row.summary,
    createdAt: row.createdAt,
    actorUser: { id: row.actorUserId, username: row.actorUsername },
  }));

  const responderIds = Array.from(
    new Set(recentFeedbackRows.map((row) => row.respondedByUserId).filter((v): v is string => typeof v === "string")),
  );
  const responderRows = responderIds.length
    ? await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, responderIds))
    : [];
  const responderMap = new Map(responderRows.map((row) => [row.id, row]));
  const recentFeedback = recentFeedbackRows.map((row) => ({
    id: row.id,
    category: row.category,
    status: row.status,
    subject: row.subject,
    body: row.body,
    rating: row.rating,
    imageUrl: row.imageUrl,
    adminReplyTitle: row.adminReplyTitle,
    adminReplyBody: row.adminReplyBody,
    respondedAt: row.respondedAt,
    createdAt: row.createdAt,
    user: {
      id: row.userId,
      username: row.username,
      email: row.email,
    },
    respondedBy: row.respondedByUserId
      ? {
          id: row.respondedByUserId,
          username: responderMap.get(row.respondedByUserId)?.username ?? "unknown",
        }
      : null,
  }));

  const activePlayers = activePlayersRaw.sort(
    (left, right) => activePlayerIds.indexOf(left.id) - activePlayerIds.indexOf(right.id),
  );

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
    avatar: player.avatar ?? player.image,
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