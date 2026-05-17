import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";

import { auth } from "@/features/auth/lib/auth";
import { db } from "@/db";
import { saltAndHashPassword } from "@/features/auth/utils/password";
import { passwordValidation } from "@/features/auth/utils/password-policy";
import { logging } from "@/log/ServerLogger";
import { rateLimiter } from "@/lib/rate-limiter";
import { validateCsrf as validateCSRF } from "@/lib/csrf";
import {
  isDatabaseAccountHoldError,
  isDatabaseTemporarilyUnavailableError,
} from "@/lib/db-error-utils";

const SERVICE_TYPE = "USER-PASSWORD-API";

const UpdatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256).optional(),
    newPassword: passwordValidation,
  })
  .strict();

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
        { error: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = parsed.data;

    const userResult = await db.execute(sql`
      SELECT "id", "passwordHash"
      FROM "User"
      WHERE "id" = ${session.user.id}
      LIMIT 1
    `);
    const user =
      (userResult.rows[0] as { id: string; passwordHash: string | null } | undefined) ?? null;

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

    await db.execute(sql`
      UPDATE "User"
      SET "passwordHash" = ${nextHash},
          "resetToken" = NULL,
          "resetTokenExpiry" = NULL,
          "pvpWsTokenVersion" = "pvpWsTokenVersion" + 1,
          "pvpWsTokensValidAfter" = NOW()
      WHERE "id" = ${session.user.id}
    `);

    logging.info("User password updated", {
      requestId,
      service: SERVICE_TYPE,
      userId: session.user.id,
      hadPassword: !!user.passwordHash,
    });

    return NextResponse.json({ message: "Password updated successfully" });
  } catch (error) {
    if (isDatabaseAccountHoldError(error)) {
      logging.warn("Password update blocked by database provider account hold", {
        requestId,
        service: SERVICE_TYPE,
      });

      return NextResponse.json(
        {
          error: "Password update is temporarily unavailable due to a database account hold",
          code: "DB_ACCOUNT_HOLD",
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

    if (isDatabaseTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        {
          error: "Password update is temporarily unavailable",
          code: "DB_TEMP_UNAVAILABLE",
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

    logging.error("Password update failed", error, {
      requestId,
      service: SERVICE_TYPE,
    });

    return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
  }
}
