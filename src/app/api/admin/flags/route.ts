export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { cheatFlags, pvpMatches, users } from "@/db/schema";
import { authorizeAdminRequest } from "@/app/api/shared.server";
import { createAdminAuditLog } from "@/features/admin/server/audit-log";

const ReviewFlagSchema = z.object({
  flagId: z.string().min(1),
  reviewed: z.boolean(),
});

export async function GET(req: NextRequest) {
  const adminUserId = await authorizeAdminRequest(req);
  if (!adminUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(searchParams?.get("limit") ?? "50")));

  const flagRows = await db
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
      matchStatus: pvpMatches.status,
      textId: pvpMatches.textId,
      matchCreatedAt: pvpMatches.createdAt,
    })
    .from(cheatFlags)
    .innerJoin(users, eq(cheatFlags.userId, users.id))
    .innerJoin(pvpMatches, eq(cheatFlags.matchId, pvpMatches.id))
    .orderBy(desc(cheatFlags.createdAt))
    .limit(limit);

  const flags = flagRows.map((row) => ({
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
    user: { id: row.userId, username: row.username, role: row.role },
    match: { id: row.matchId, status: row.matchStatus, textId: row.textId, createdAt: row.matchCreatedAt },
  }));

  return NextResponse.json({
    requestedBy: adminUserId,
    count: flags.length,
    flags,
  });
}

export async function PATCH(req: NextRequest) {
  const adminUserId = await authorizeAdminRequest(req);
  if (!adminUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = ReviewFlagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  await db
    .update(cheatFlags)
    .set({ reviewed: parsed.data.reviewed, updatedAt: new Date() })
    .where(eq(cheatFlags.id, parsed.data.flagId));

  const updatedRows = await db
    .select({
      id: cheatFlags.id,
      userId: cheatFlags.userId,
      matchId: cheatFlags.matchId,
      confidence: cheatFlags.confidence,
      reviewed: cheatFlags.reviewed,
      wouldSanction: cheatFlags.wouldSanction,
      flags: cheatFlags.flags,
      metadata: cheatFlags.metadata,
      createdAt: cheatFlags.createdAt,
      updatedAt: cheatFlags.updatedAt,
      username: users.username,
      role: users.role,
      banned: users.banned,
      matchStatus: pvpMatches.status,
      textId: pvpMatches.textId,
      matchCreatedAt: pvpMatches.createdAt,
    })
    .from(cheatFlags)
    .innerJoin(users, eq(cheatFlags.userId, users.id))
    .innerJoin(pvpMatches, eq(cheatFlags.matchId, pvpMatches.id))
    .where(eq(cheatFlags.id, parsed.data.flagId))
    .limit(1);

  const updatedFlag = updatedRows[0]
    ? {
        id: updatedRows[0].id,
        userId: updatedRows[0].userId,
        matchId: updatedRows[0].matchId,
        confidence: updatedRows[0].confidence,
        reviewed: updatedRows[0].reviewed,
        wouldSanction: updatedRows[0].wouldSanction,
        flags: updatedRows[0].flags,
        metadata: updatedRows[0].metadata,
        createdAt: updatedRows[0].createdAt,
        updatedAt: updatedRows[0].updatedAt,
        user: {
          id: updatedRows[0].userId,
          username: updatedRows[0].username,
          role: updatedRows[0].role,
          banned: updatedRows[0].banned,
        },
        match: {
          id: updatedRows[0].matchId,
          status: updatedRows[0].matchStatus,
          textId: updatedRows[0].textId,
          createdAt: updatedRows[0].matchCreatedAt,
        },
      }
    : null;

  if (!updatedFlag) {
    return NextResponse.json({ error: "Flag not found" }, { status: 404 });
  }

  await createAdminAuditLog({
    actorUserId: adminUserId,
    action: parsed.data.reviewed ? "review_flag" : "reopen_flag",
    entityType: "cheat_flag",
    entityId: updatedFlag.id,
    targetUserId: updatedFlag.user.id,
    summary: `Admin ${parsed.data.reviewed ? "reviewed" : "reopened"} cheat flag for ${updatedFlag.user.username}`,
    metadata: {
      confidence: updatedFlag.confidence,
      wouldSanction: updatedFlag.wouldSanction,
      reviewed: updatedFlag.reviewed,
    },
  });

  return NextResponse.json({ updatedBy: adminUserId, flag: updatedFlag });
}