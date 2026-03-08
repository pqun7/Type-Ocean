import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

import { auth } from "@/features/auth/lib/auth";
import prisma from "@/features/auth/lib/db";
import { saltAndHashPassword } from "@/features/auth/utils/password";
import { passwordValidation } from "@/features/auth/utils/password-policy";
import { logging } from "@/log/ServerLogger";
import { rateLimiter } from "@/lib/rate-limiter";

const SERVICE_TYPE = "USER-PASSWORD-API";

const UpdatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256).optional(),
    newPassword: passwordValidation,
  })
  .strict();

function validateCSRF(req: NextRequest): string | null {
  const origin = req.headers.get("origin") || "";
  const referer = req.headers.get("referer") || "";
  const host = new URL(req.url).origin;

  if (origin && origin !== host) return "Invalid origin";
  if (referer && !referer.startsWith(host)) return "Invalid referer";
  return null;
}

export async function PATCH(req: NextRequest) {
  const requestId = uuidv4();

  const rl = await rateLimiter.applyRateLimit(req, "/api/user/password:PATCH");
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rl.headers });
  }

  const csrfError = validateCSRF(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 });
  }

  try {
    const session = await auth();
    if (!session?.user?.id) {
      logging.warn("Unauthorized password update attempt", {
        requestId,
        service: SERVICE_TYPE,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = UpdatePasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.passwordHash) {
      if (!currentPassword) {
        return NextResponse.json({ error: "Current password is required" }, { status: 403 });
      }

      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
      }

      const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
      if (isSamePassword) {
        return NextResponse.json(
          { error: "New password must be different from your current password" },
          { status: 400 }
        );
      }
    }

    const nextHash = await saltAndHashPassword(newPassword);

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        passwordHash: nextHash,
        resetToken: null,
        resetTokenExpiry: null,
        pvpWsTokenVersion: { increment: 1 },
        pvpWsTokensValidAfter: new Date(),
      },
      select: { id: true },
    });

    logging.info("User password updated", {
      requestId,
      service: SERVICE_TYPE,
      userId: session.user.id,
      hadPassword: !!user.passwordHash,
    });

    return NextResponse.json({ message: "Password updated successfully" });
  } catch (error) {
    logging.error("Password update failed", error, {
      requestId,
      service: SERVICE_TYPE,
    });

    return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
  }
}
