export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import prisma from "@/features/auth/lib/db";
import { authorizeAdminActor } from "@/app/api/shared.server";
import { createAdminAuditLog } from "@/features/admin/server/audit-log";
import { setAdminNotice } from "@/features/admin/server/admin-notices";

const FeedbackStatusSchema = z.enum(["OPEN", "IN_REVIEW", "REPLIED", "RESOLVED"]);

const FeedbackReplySchema = z
  .object({
    feedbackId: z.string().min(1),
    status: FeedbackStatusSchema.optional(),
    replyTitle: z.string().trim().min(3).max(120).optional(),
    replyBody: z.string().trim().min(5).max(2000).optional(),
    severity: z.enum(["info", "warning", "critical"]).optional(),
  })
  .superRefine((value, ctx) => {
    const hasTitle = Boolean(value.replyTitle?.trim());
    const hasBody = Boolean(value.replyBody?.trim());

    if (hasTitle !== hasBody) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reply title and body must be provided together",
      });
    }

    if (!value.status && !hasTitle && !hasBody) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Nothing to update",
      });
    }
  });

export async function PATCH(req: NextRequest) {
  const adminActor = await authorizeAdminActor(req);
  if (!adminActor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = FeedbackReplySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const feedback = await prisma.userFeedback.findUnique({
    where: { id: parsed.data.feedbackId },
    select: {
      id: true,
      userId: true,
      subject: true,
      status: true,
      user: {
        select: {
          username: true,
          email: true,
        },
      },
    },
  });

  if (!feedback) {
    return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
  }

  const hasReply = Boolean(parsed.data.replyTitle && parsed.data.replyBody);
  const nextStatus = parsed.data.status ?? (hasReply ? "REPLIED" : feedback.status);

  const updatedFeedback = await prisma.userFeedback.update({
    where: { id: feedback.id },
    data: {
      status: nextStatus,
      adminReplyTitle: hasReply ? parsed.data.replyTitle : undefined,
      adminReplyBody: hasReply ? parsed.data.replyBody : undefined,
      respondedAt: hasReply ? new Date() : undefined,
      respondedByUserId: hasReply ? adminActor.id : undefined,
    },
    select: {
      id: true,
      category: true,
      status: true,
      subject: true,
      body: true,
      rating: true,
      imageUrl: true,
      adminReplyTitle: true,
      adminReplyBody: true,
      respondedAt: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
      respondedBy: {
        select: {
          id: true,
          username: true,
        },
      },
    },
  });

  if (hasReply) {
    await setAdminNotice({
      userId: feedback.userId,
      title: parsed.data.replyTitle!,
      body: parsed.data.replyBody!,
      severity: parsed.data.severity ?? "info",
      createdByUserId: adminActor.id,
      ttlSeconds: 7 * 24 * 60 * 60,
    });
  }

  await createAdminAuditLog({
    actorUserId: adminActor.id,
    action: hasReply ? "reply_feedback" : "update_feedback_status",
    entityType: "user_feedback",
    entityId: feedback.id,
    targetUserId: feedback.userId,
    summary: hasReply
      ? `Admin replied to ${feedback.user.username}'s feedback: ${feedback.subject}`
      : `Admin updated feedback status for ${feedback.user.username}`,
    metadata: {
      previousStatus: feedback.status,
      nextStatus,
      severity: parsed.data.severity ?? null,
    },
  });

  return NextResponse.json({ updatedBy: adminActor.id, feedback: updatedFeedback });
}