import "server-only";

import type { Prisma } from "@prisma/client";

import prisma from "@/features/auth/lib/db";

export async function createAdminAuditLog(params: {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  targetUserId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.adminActionLog.create({
    data: {
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      targetUserId: params.targetUserId ?? null,
      summary: params.summary,
      metadata: params.metadata,
    },
  });
}