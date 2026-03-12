import "server-only";

import { connectIfNeeded, redis } from "@/lib/redis";

export type AdminNoticeSeverity = "info" | "warning" | "critical";

export type AdminNotice = {
  id: string;
  userId: string;
  title: string;
  body: string;
  severity: AdminNoticeSeverity;
  createdAt: string;
  createdByUserId: string;
  expiresAt: string;
};

const ADMIN_NOTICE_PREFIX = "admin:notice:user";
const DEFAULT_NOTICE_TTL_SECONDS = 7 * 24 * 60 * 60;

function getAdminNoticeKey(userId: string): string {
  return `${ADMIN_NOTICE_PREFIX}:${userId}`;
}

export async function getAdminNotice(userId: string): Promise<AdminNotice | null> {
  try {
    await connectIfNeeded();
    const raw = await redis.get(getAdminNoticeKey(userId));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as AdminNotice;
  } catch {
    return null;
  }
}

export async function setAdminNotice(params: {
  userId: string;
  title: string;
  body: string;
  severity?: AdminNoticeSeverity;
  createdByUserId: string;
  ttlSeconds?: number;
}): Promise<AdminNotice> {
  const ttlSeconds = Math.max(60, params.ttlSeconds ?? DEFAULT_NOTICE_TTL_SECONDS);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);

  const notice: AdminNotice = {
    id: `${params.userId}-${createdAt.getTime()}`,
    userId: params.userId,
    title: params.title,
    body: params.body,
    severity: params.severity ?? "info",
    createdAt: createdAt.toISOString(),
    createdByUserId: params.createdByUserId,
    expiresAt: expiresAt.toISOString(),
  };

  await connectIfNeeded();
  await redis.setex(getAdminNoticeKey(params.userId), ttlSeconds, JSON.stringify(notice));

  return notice;
}

export async function clearAdminNotice(userId: string): Promise<void> {
  try {
    await connectIfNeeded();
    await redis.del(getAdminNoticeKey(userId));
  } catch {
    // Best-effort cleanup.
  }
}