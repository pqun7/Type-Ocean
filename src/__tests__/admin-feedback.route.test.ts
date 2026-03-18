/** @jest-environment node */

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/feedback/route";
import dbClient from "@/features/auth/lib/db";
import { authorizeAdminActor } from "@/app/api/shared.server";
import { createAdminAuditLog } from "@/features/admin/server/audit-log";
import { setAdminNotice } from "@/features/admin/server/admin-notices";

type DbMock = {
  userFeedback: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

const dbMock = dbClient as unknown as DbMock;

jest.mock("@/features/auth/lib/db", () => {
  const dbMock = {
    userFeedback: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  return {
    __esModule: true,
    default: dbMock,
  };
});

jest.mock("@/app/api/shared.server", () => ({
  authorizeAdminActor: jest.fn(),
}));

jest.mock("@/features/admin/server/audit-log", () => ({
  createAdminAuditLog: jest.fn(),
}));

jest.mock("@/features/admin/server/admin-notices", () => ({
  setAdminNotice: jest.fn(),
}));

describe("admin feedback route", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (authorizeAdminActor as jest.Mock).mockResolvedValue({
      id: "admin-1",
      username: "root-admin",
      email: "root@example.com",
      isPrimaryAdmin: true,
    });
  });

  it("rejects non-admin requests", async () => {
    (authorizeAdminActor as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/admin/feedback", {
      method: "PATCH",
      body: JSON.stringify({ feedbackId: "feedback-1", status: "IN_REVIEW" }),
      headers: { "content-type": "application/json" },
    });

    const response = await PATCH(req);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("updates feedback status without creating a user notice", async () => {
    dbMock.userFeedback.findUnique.mockResolvedValue({
      id: "feedback-1",
      userId: "user-1",
      subject: "Latency spike",
      status: "OPEN",
      user: {
        username: "player-one",
        email: "player-one@example.com",
      },
    });

    dbMock.userFeedback.update.mockResolvedValue({
      id: "feedback-1",
      category: "bug",
      status: "IN_REVIEW",
      subject: "Latency spike",
      body: "The match lagged badly.",
      rating: null,
      imageUrl: null,
      adminReplyTitle: null,
      adminReplyBody: null,
      respondedAt: null,
      createdAt: "2026-03-12T10:00:00.000Z",
      user: {
        id: "user-1",
        username: "player-one",
        email: "player-one@example.com",
      },
      respondedBy: null,
    });

    const req = new NextRequest("http://localhost:3000/api/admin/feedback", {
      method: "PATCH",
      body: JSON.stringify({ feedbackId: "feedback-1", status: "IN_REVIEW" }),
      headers: { "content-type": "application/json" },
    });

    const response = await PATCH(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.feedback.status).toBe("IN_REVIEW");
    expect(setAdminNotice).not.toHaveBeenCalled();
    expect(createAdminAuditLog).toHaveBeenCalledWith({
      actorUserId: "admin-1",
      action: "update_feedback_status",
      entityType: "user_feedback",
      entityId: "feedback-1",
      targetUserId: "user-1",
      summary: "Admin updated feedback status for player-one",
      metadata: {
        previousStatus: "OPEN",
        nextStatus: "IN_REVIEW",
        severity: null,
      },
    });
  });

  it("creates a notice and audit entry when replying to feedback", async () => {
    dbMock.userFeedback.findUnique.mockResolvedValue({
      id: "feedback-2",
      userId: "user-2",
      subject: "Report outcome",
      status: "OPEN",
      user: {
        username: "player-two",
        email: "player-two@example.com",
      },
    });

    dbMock.userFeedback.update.mockResolvedValue({
      id: "feedback-2",
      category: "complaint",
      status: "REPLIED",
      subject: "Report outcome",
      body: "Please review the moderation result.",
      rating: 4,
      imageUrl: null,
      adminReplyTitle: "Action taken",
      adminReplyBody: "We reviewed the issue and applied the needed changes.",
      respondedAt: "2026-03-12T11:00:00.000Z",
      createdAt: "2026-03-12T09:00:00.000Z",
      user: {
        id: "user-2",
        username: "player-two",
        email: "player-two@example.com",
      },
      respondedBy: {
        id: "admin-1",
        username: "root-admin",
      },
    });

    const req = new NextRequest("http://localhost:3000/api/admin/feedback", {
      method: "PATCH",
      body: JSON.stringify({
        feedbackId: "feedback-2",
        replyTitle: "Action taken",
        replyBody: "We reviewed the issue and applied the needed changes.",
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await PATCH(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.feedback.status).toBe("REPLIED");
    expect(setAdminNotice).toHaveBeenCalledWith({
      userId: "user-2",
      title: "Action taken",
      body: "We reviewed the issue and applied the needed changes.",
      severity: "info",
      createdByUserId: "admin-1",
      ttlSeconds: 7 * 24 * 60 * 60,
    });
    expect(createAdminAuditLog).toHaveBeenCalledWith({
      actorUserId: "admin-1",
      action: "reply_feedback",
      entityType: "user_feedback",
      entityId: "feedback-2",
      targetUserId: "user-2",
      summary: "Admin replied to player-two's feedback: Report outcome",
      metadata: {
        previousStatus: "OPEN",
        nextStatus: "REPLIED",
        severity: null,
      },
    });
  });
});