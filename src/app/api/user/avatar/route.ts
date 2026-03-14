import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { del, put } from "@vercel/blob";

import { env } from "@/env.mjs";
import { auth } from "@/features/auth/lib/auth";
import prisma from "@/features/auth/lib/db";
import { syncPlayerProfile } from "@/features/auth/server/player-profile";
import { refreshLeaderboardProfileCache } from "@/features/pvp/server/leaderboard-cache";
import { rateLimiter } from "@/lib/rate-limiter";
import {
  isPrismaAccountHoldError,
  isPrismaTemporarilyUnavailableError,
} from "@/lib/prisma-error-utils";

export const runtime = "nodejs";

// Keep well under Vercel Function body size limit (~4.5MB).
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/webp", "image/jpeg"]);

function extFromMime(mime: string): "webp" | "jpg" {
  return mime === "image/webp" ? "webp" : "jpg";
}

function validateCSRF(req: NextRequest): string | null {
  const origin = req.headers.get("origin") || "";
  const referer = req.headers.get("referer") || "";
  const host = new URL(req.url).origin;

  if (origin && origin !== host) return "Invalid origin";
  if (referer && !referer.startsWith(host)) return "Invalid referer";
  return null;
}

function isVercelBlobUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  const rl = await rateLimiter.applyRateLimit(req, "/api/user/avatar:POST");
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rl.headers });
  }

  const csrfError = validateCSRF(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError, requestId }, { status: 403 });
  }

  if (!env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Avatar uploads are not configured (missing BLOB_READ_WRITE_TOKEN)", requestId },
      { status: 500 }
    );
  }

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data", requestId }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file", requestId }, { status: 400 });
    }

    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: "Unsupported image type", requestId }, { status: 400 });
    }

    if (file.size <= 0 || file.size > MAX_AVATAR_BYTES) {
      return NextResponse.json({ error: "Avatar file too large", requestId }, { status: 400 });
    }

    const current = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        image: true,
        username: true,
        profile: { select: { avatar: true } },
      },
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = extFromMime(file.type);
    const pathname = `avatars/${session.user.id}/${Date.now()}-${randomUUID()}.${ext}`;

    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: file.type,
    });

    // Delete previous Blob avatar best-effort
    const candidates = [current?.profile?.avatar, current?.image].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    for (const candidate of new Set(candidates)) {
      if (!isVercelBlobUrl(candidate)) continue;
      if (candidate === blob.url) continue;
      try {
        await del(candidate);
      } catch {
        // ignore
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: { image: blob.url },
      select: { username: true },
    });

    await syncPlayerProfile({
      userId: session.user.id,
      username: updatedUser.username,
      update: { avatar: blob.url },
      create: {
        username: updatedUser.username,
        avatar: blob.url,
      },
    });

    void refreshLeaderboardProfileCache(session.user.id).catch(() => {
      // ignore
    });

    return NextResponse.json({ url: blob.url, requestId });
  } catch (error) {
    if (isPrismaAccountHoldError(error)) {
      return NextResponse.json(
        {
          error: "Avatar update is temporarily unavailable due to a database account hold",
          code: "DB_ACCOUNT_HOLD",
          requestId,
        },
        {
          status: 503,
          headers: {
            "Retry-After": "120",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    if (isPrismaTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        {
          error: "Avatar update is temporarily unavailable",
          code: "DB_TEMP_UNAVAILABLE",
          requestId,
        },
        {
          status: 503,
          headers: {
            "Retry-After": "60",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), requestId },
      { status: 400 }
    );
  }
}
