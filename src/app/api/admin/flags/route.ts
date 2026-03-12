export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import prisma from "@/features/auth/lib/db";
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
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "50")));

  const flags = await prisma.cheatFlag.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      user: { select: { id: true, username: true, role: true } },
      match: { select: { id: true, status: true, textId: true, createdAt: true } },
    },
  });

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

  const updatedFlag = await prisma.cheatFlag.update({
    where: { id: parsed.data.flagId },
    data: { reviewed: parsed.data.reviewed },
    include: {
      user: { select: { id: true, username: true, role: true, banned: true } },
      match: { select: { id: true, status: true, textId: true, createdAt: true } },
    },
  });

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