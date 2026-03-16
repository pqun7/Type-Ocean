export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { userFeedback } from "@/db/schema";
import { env } from "@/env.mjs";
import { auth } from "@/lib/auth";
import { rateLimiter } from "@/lib/rate-limiter";

const FeedbackCategorySchema = z.enum(["complaint", "suggestion", "rating", "bug", "other"]);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function validateCSRF(req: NextRequest): string | null {
  const origin = req.headers.get("origin") || "";
  const referer = req.headers.get("referer") || "";
  const host = new URL(req.url).origin;

  if (origin && origin !== host) return "Invalid origin";
  if (referer && !referer.startsWith(host)) return "Invalid referer";
  return null;
}

function extFromMime(mime: string): "png" | "jpg" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function parseOptionalRating(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const feedback = await db
    .select({
      id: userFeedback.id,
      category: userFeedback.category,
      status: userFeedback.status,
      subject: userFeedback.subject,
      body: userFeedback.body,
      rating: userFeedback.rating,
      imageUrl: userFeedback.imageUrl,
      adminReplyTitle: userFeedback.adminReplyTitle,
      adminReplyBody: userFeedback.adminReplyBody,
      respondedAt: userFeedback.respondedAt,
      createdAt: userFeedback.createdAt,
    })
    .from(userFeedback)
    .where(eq(userFeedback.userId, session.user.id))
    .orderBy(desc(userFeedback.createdAt))
    .limit(10);

  return NextResponse.json({ feedback });
}

export async function POST(req: NextRequest) {
  const rl = await rateLimiter.applyRateLimit(req, "/api/feedback:POST");
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rl.headers });
  }

  const csrfError = validateCSRF(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403, headers: rl.headers });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rl.headers });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400, headers: rl.headers });
  }

  const category = FeedbackCategorySchema.safeParse(form.get("category"));
  const subject = z.string().trim().min(3).max(120).safeParse(form.get("subject"));
  const body = z.string().trim().min(10).max(4000).safeParse(form.get("body"));
  const rating = parseOptionalRating(form.get("rating"));

  if (!category.success || !subject.success || !body.success) {
    return NextResponse.json({ error: "Invalid feedback payload" }, { status: 400, headers: rl.headers });
  }

  if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
    return NextResponse.json({ error: "Rating must be between 1 and 5" }, { status: 400, headers: rl.headers });
  }

  let imageUrl: string | null = null;
  const image = form.get("image");

  if (image instanceof File && image.size > 0) {
    if (!ALLOWED_IMAGE_MIME.has(image.type)) {
      return NextResponse.json({ error: "Unsupported image type" }, { status: 400, headers: rl.headers });
    }

    if (image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image file too large" }, { status: 400, headers: rl.headers });
    }

    if (!env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "Image uploads are not configured" }, { status: 500, headers: rl.headers });
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const pathname = `feedback/${session.user.id}/${Date.now()}-${randomUUID()}.${extFromMime(image.type)}`;
    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: image.type,
    });

    imageUrl = blob.url;
  }

  const createdRows = await db
    .insert(userFeedback)
    .values({
      userId: session.user.id,
      category: category.data,
      subject: subject.data,
      body: body.data,
      rating,
      imageUrl,
    })
    .returning({
      id: userFeedback.id,
      category: userFeedback.category,
      status: userFeedback.status,
      subject: userFeedback.subject,
      body: userFeedback.body,
      rating: userFeedback.rating,
      imageUrl: userFeedback.imageUrl,
      createdAt: userFeedback.createdAt,
    });

  const feedback = createdRows[0] ?? null;

  return NextResponse.json({ feedback }, { headers: rl.headers });
}
