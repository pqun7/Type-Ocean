export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import prisma from "@/features/auth/lib/db";
import { authorizeAdminActor, authorizePrimaryAdminRequest } from "@/app/api/shared.server";
import { createAdminAuditLog } from "@/features/admin/server/audit-log";

const AdminUserActionSchema = z.object({
  userId: z.string().min(1),
  action: z.enum(["ban", "unban"]),
});

export async function PATCH(req: NextRequest) {
  const adminActor = await authorizeAdminActor(req);
  if (!adminActor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = AdminUserActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { userId, action } = parsed.data;
  const nextBanned = action === "ban";

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      banned: true,
      isPrimaryAdmin: true,
      updatedAt: true,
    },
  });

  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (targetUser.id === adminActor.id && nextBanned) {
    return NextResponse.json({ error: "You cannot ban your own account" }, { status: 400 });
  }

  if (targetUser.role === "admin" && !adminActor.isPrimaryAdmin && targetUser.id !== adminActor.id) {
    return NextResponse.json({ error: "Only the primary admin can moderate another admin account" }, { status: 403 });
  }

  if (targetUser.isPrimaryAdmin && targetUser.id !== adminActor.id) {
    return NextResponse.json({ error: "Primary admin cannot be moderated by another admin" }, { status: 403 });
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { banned: nextBanned },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      banned: true,
      isPrimaryAdmin: true,
      updatedAt: true,
    },
  });

  await createAdminAuditLog({
    actorUserId: adminActor.id,
    action,
    entityType: "user",
    entityId: updatedUser.id,
    targetUserId: updatedUser.id,
    summary: `Admin ${action} user ${updatedUser.username}`,
    metadata: {
      email: updatedUser.email,
      role: updatedUser.role,
      banned: updatedUser.banned,
    },
  });

  return NextResponse.json({
    updatedBy: adminActor.id,
    user: updatedUser,
  });
}

const DeleteAdminSchema = z.object({
  userId: z.string().min(1),
});

export async function DELETE(req: NextRequest) {
  const adminActor = await authorizePrimaryAdminRequest(req);
  if (!adminActor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = DeleteAdminSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      isPrimaryAdmin: true,
    },
  });

  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (targetUser.id === adminActor.id) {
    return NextResponse.json({ error: "Primary admin cannot delete their own account here" }, { status: 400 });
  }

  if (targetUser.isPrimaryAdmin) {
    return NextResponse.json({ error: "Primary admin account cannot be deleted" }, { status: 400 });
  }

  if (targetUser.role !== "admin") {
    return NextResponse.json({ error: "Target user is not an admin" }, { status: 400 });
  }

  const updatedUser = await prisma.user.update({
    where: { id: targetUser.id },
    data: {
      role: "user",
      isPrimaryAdmin: false,
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      banned: true,
      isPrimaryAdmin: true,
      updatedAt: true,
    },
  });

  await createAdminAuditLog({
    actorUserId: adminActor.id,
    action: "remove_admin_access",
    entityType: "user",
    entityId: targetUser.id,
    targetUserId: targetUser.id,
    summary: `Primary admin removed admin access from ${targetUser.username}`,
    metadata: {
      email: targetUser.email,
      previousRole: targetUser.role,
      nextRole: updatedUser.role,
    },
  });

  return NextResponse.json({
    updatedBy: adminActor.id,
    user: updatedUser,
  });
}