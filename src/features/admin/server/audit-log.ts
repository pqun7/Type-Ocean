import "server-only";

import { db } from "@/db";
import { adminActionLogs } from "@/db/schema";

type JsonMetadata = Record<string, unknown> | unknown[] | string | number | boolean | null;

export async function createAdminAuditLog(params: {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  targetUserId?: string | null;
  summary: string;
  metadata?: JsonMetadata;
}) {
  const rows = await db
    .insert(adminActionLogs)
    .values({
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      targetUserId: params.targetUserId ?? null,
      summary: params.summary,
      metadata: params.metadata,
    })
    .returning();

  return rows[0] ?? null;
}