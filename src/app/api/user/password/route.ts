import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

import { auth } from "@/features/auth/lib/auth";
import prisma from "@/features/auth/lib/db";
import { logging } from "@/log/ServerLogger";
import { rateLimiter } from "@/lib/rate-limiter";

const SERVICE_TYPE = "USER-PASSWORD-API";

const UpdatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256).optional(),
    newPassword: z.string().min(8).max(256),
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
