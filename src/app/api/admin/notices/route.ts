export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { authorizeAdminRequest } from "@/app/api/shared.server";
import { setAdminNotice } from "@/features/admin/server/admin-notices";
import { createAdminAuditLog } from "@/features/admin/server/audit-log";

const AdminNoticeSchema = z.object({
  userId: z.string().min(1),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(2000),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  ttlHours: z.number().int().min(1).max(24 * 14).optional(),
});

export async function POST(req: NextRequest) {
  const adminUserId = await authorizeAdminRequest(req);
  if (!adminUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = AdminNoticeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const targetUserRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, parsed.data.userId))
    .limit(1);

  const targetUser = targetUserRows[0] ?? null;

  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const notice = await setAdminNotice({
    userId: parsed.data.userId,
    title: parsed.data.title,
    body: parsed.data.body,
    severity: parsed.data.severity,
    createdByUserId: adminUserId,
    ttlSeconds: (parsed.data.ttlHours ?? 24) * 60 * 60,
  });

  await createAdminAuditLog({
    actorUserId: adminUserId,
    action: "send_notice",
    entityType: "admin_notice",
    entityId: notice.id,
    targetUserId: parsed.data.userId,
    summary: `Admin sent ${notice.severity} notice to user ${parsed.data.userId}`,
    metadata: {
      title: notice.title,
      severity: notice.severity,
      expiresAt: notice.expiresAt,
    },
  });

  return NextResponse.json({ notice, sentBy: adminUserId });
}