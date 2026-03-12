/** @jest-environment node */

import { NextRequest } from "next/server";
import { DELETE, PATCH } from "@/app/api/admin/users/route";
import prisma from "@/features/auth/lib/db";
import { authorizeAdminActor, authorizePrimaryAdminRequest } from "@/app/api/shared.server";
import { createAdminAuditLog } from "@/features/admin/server/audit-log";

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

const prismaMock = prisma as unknown as PrismaMock;

jest.mock("@/features/auth/lib/db", () => {
  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  return {
    __esModule: true,
    default: prismaMock,
  };
});

jest.mock("@/app/api/shared.server", () => ({
  authorizeAdminActor: jest.fn(),
  authorizePrimaryAdminRequest: jest.fn(),
}));

jest.mock("@/features/admin/server/audit-log", () => ({
  createAdminAuditLog: jest.fn(),
}));

describe("admin users route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prevents a non-primary admin from moderating another admin", async () => {
    (authorizeAdminActor as jest.Mock).mockResolvedValue({
      id: "admin-2",
      username: "assistant-admin",
      isPrimaryAdmin: false,
    });

    prismaMock.user.findUnique.mockResolvedValue({
      id: "admin-3",
      username: "other-admin",
      email: "other-admin@example.com",
      role: "admin",
      banned: false,
      isPrimaryAdmin: false,
      updatedAt: new Date("2026-03-12T10:00:00.000Z"),
    });

    const req = new NextRequest("http://localhost:3000/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ userId: "admin-3", action: "ban" }),
      headers: { "content-type": "application/json" },
    });

    const response = await PATCH(req);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only the primary admin can moderate another admin account",
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("removes admin access for a non-primary admin", async () => {
    (authorizePrimaryAdminRequest as jest.Mock).mockResolvedValue({
      id: "admin-1",
      username: "root-admin",
      isPrimaryAdmin: true,
    });

    prismaMock.user.findUnique.mockResolvedValue({
      id: "admin-2",
      username: "assistant-admin",
      email: "assistant-admin@example.com",
      role: "admin",
      isPrimaryAdmin: false,
    });

    prismaMock.user.update.mockResolvedValue({
      id: "admin-2",
      username: "assistant-admin",
      email: "assistant-admin@example.com",
      role: "user",
      banned: false,
      isPrimaryAdmin: false,
      updatedAt: new Date("2026-03-12T11:00:00.000Z"),
    });

    const req = new NextRequest("http://localhost:3000/api/admin/users", {
      method: "DELETE",
      body: JSON.stringify({ userId: "admin-2" }),
      headers: { "content-type": "application/json" },
    });

    const response = await DELETE(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.role).toBe("user");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "admin-2" },
      data: {
        role: "user",
        isPrimaryAdmin: false,
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        banned: true,
        isPrimaryAdmin: true,
        updatedAt: true,
      },
    });
    expect(createAdminAuditLog).toHaveBeenCalledWith({
      actorUserId: "admin-1",
      action: "remove_admin_access",
      entityType: "user",
      entityId: "admin-2",
      targetUserId: "admin-2",
      summary: "Primary admin removed admin access from assistant-admin",
      metadata: {
        email: "assistant-admin@example.com",
        previousRole: "admin",
        nextRole: "user",
      },
    });
  });

  it("rejects deleting the primary admin through the admin removal endpoint", async () => {
    (authorizePrimaryAdminRequest as jest.Mock).mockResolvedValue({
      id: "admin-1",
      username: "root-admin",
      isPrimaryAdmin: true,
    });

    prismaMock.user.findUnique.mockResolvedValue({
      id: "admin-1",
      username: "root-admin",
      email: "root@example.com",
      role: "admin",
      isPrimaryAdmin: true,
    });

    const req = new NextRequest("http://localhost:3000/api/admin/users", {
      method: "DELETE",
      body: JSON.stringify({ userId: "admin-1" }),
      headers: { "content-type": "application/json" },
    });

    const response = await DELETE(req);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Primary admin cannot delete their own account here",
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});