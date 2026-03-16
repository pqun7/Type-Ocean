export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userFeedback, users } from "@/db/schema";
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

  const feedbackRows = await db
    .select({
      id: userFeedback.id,
      userId: userFeedback.userId,
      subject: userFeedback.subject,
      status: userFeedback.status,
      username: users.username,
      email: users.email,
    })
    .from(userFeedback)
    .innerJoin(users, eq(userFeedback.userId, users.id))
    .where(eq(userFeedback.id, parsed.data.feedbackId))
    .limit(1);

  const feedback = feedbackRows[0]
    ? {
        id: feedbackRows[0].id,
        userId: feedbackRows[0].userId,
        subject: feedbackRows[0].subject,
        status: feedbackRows[0].status,
        user: {
          username: feedbackRows[0].username,
          email: feedbackRows[0].email,
        },
      }
    : null;

  if (!feedback) {
    return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
  }

  const hasReply = Boolean(parsed.data.replyTitle && parsed.data.replyBody);
  const nextStatus = parsed.data.status ?? (hasReply ? "REPLIED" : feedback.status);

  await db
    .update(userFeedback)
    .set({
      status: nextStatus,
      adminReplyTitle: hasReply ? parsed.data.replyTitle : undefined,
      adminReplyBody: hasReply ? parsed.data.replyBody : undefined,
      respondedAt: hasReply ? new Date() : undefined,
      respondedByUserId: hasReply ? adminActor.id : undefined,
      updatedAt: new Date(),
    })
    .where(eq(userFeedback.id, feedback.id));

  const updatedRows = await db
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
      userId: users.id,
      username: users.username,
      userEmail: users.email,
      respondedByUserId: userFeedback.respondedByUserId,
    })
    .from(userFeedback)
    .innerJoin(users, eq(userFeedback.userId, users.id))
    .where(eq(userFeedback.id, feedback.id))
    .limit(1);

  const responderRows = updatedRows[0]?.respondedByUserId
    ? await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, updatedRows[0].respondedByUserId))
        .limit(1)
    : [];

  const updatedFeedback = updatedRows[0]
    ? {
        id: updatedRows[0].id,
        category: updatedRows[0].category,
        status: updatedRows[0].status,
        subject: updatedRows[0].subject,
        body: updatedRows[0].body,
        rating: updatedRows[0].rating,
        imageUrl: updatedRows[0].imageUrl,
        adminReplyTitle: updatedRows[0].adminReplyTitle,
        adminReplyBody: updatedRows[0].adminReplyBody,
        respondedAt: updatedRows[0].respondedAt,
        createdAt: updatedRows[0].createdAt,
        user: {
          id: updatedRows[0].userId,
          username: updatedRows[0].username,
          email: updatedRows[0].userEmail,
        },
        respondedBy: responderRows[0]
          ? {
              id: responderRows[0].id,
              username: responderRows[0].username,
            }
          : null,
      }
    : null;

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