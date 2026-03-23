/** @jest-environment node */

import { NextRequest } from "next/server";

import { DELETE, PATCH } from "@/app/api/admin/users/route";
import { authorizeAdminActor, authorizePrimaryAdminRequest } from "@/app/api/shared.server";
import { createAdminAuditLog } from "@/features/admin/server/audit-log";

const mockSelectQueue: unknown[][] = [];

var mockDb: {
  select: jest.Mock;
  selectFrom: jest.Mock;
  selectWhere: jest.Mock;
  selectLimit: jest.Mock;
  update: jest.Mock;
  updateSet: jest.Mock;
  updateWhere: jest.Mock;
  updateReturning: jest.Mock;
};

jest.mock("@/db", () => ({
  __esModule: true,
  db: (() => {
    mockDb = {
      select: jest.fn(),
      selectFrom: jest.fn(),
      selectWhere: jest.fn(),
      selectLimit: jest.fn(() => Promise.resolve(mockSelectQueue.shift() ?? [])),
      update: jest.fn(),
      updateSet: jest.fn(),
      updateWhere: jest.fn(),
      updateReturning: jest.fn(),
    };

    mockDb.selectWhere.mockReturnValue({ limit: mockDb.selectLimit });
    mockDb.selectFrom.mockReturnValue({ where: mockDb.selectWhere });
    mockDb.select.mockReturnValue({ from: mockDb.selectFrom });
    mockDb.updateWhere.mockReturnValue({ returning: mockDb.updateReturning });
    mockDb.updateSet.mockReturnValue({ where: mockDb.updateWhere });
    mockDb.update.mockReturnValue({ set: mockDb.updateSet });

    return {
      select: mockDb.select,
      update: mockDb.update,
    };
  })(),
}));

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
    mockSelectQueue.length = 0;
    mockDb.updateReturning.mockReset();
    mockDb.updateSet.mockClear();
  });

  it("prevents a non-primary admin from moderating another admin", async () => {
    (authorizeAdminActor as jest.Mock).mockResolvedValue({
      id: "admin-2",
      username: "assistant-admin",
      isPrimaryAdmin: false,
    });
    mockSelectQueue.push([
      {
        id: "admin-3",
        username: "other-admin",
        email: "other-admin@example.com",
        role: "admin",
        banned: false,
        isPrimaryAdmin: false,
        updatedAt: new Date("2026-03-12T10:00:00.000Z"),
      },
    ]);

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
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("removes admin access for a non-primary admin", async () => {
    (authorizePrimaryAdminRequest as jest.Mock).mockResolvedValue({
      id: "admin-1",
      username: "root-admin",
      isPrimaryAdmin: true,
    });
    mockSelectQueue.push([
      {
        id: "admin-2",
        username: "assistant-admin",
        email: "assistant-admin@example.com",
        role: "admin",
        isPrimaryAdmin: false,
      },
    ]);
    mockDb.updateReturning.mockResolvedValue([
      {
        id: "admin-2",
        username: "assistant-admin",
        email: "assistant-admin@example.com",
        role: "user",
        banned: false,
        isPrimaryAdmin: false,
        updatedAt: new Date("2026-03-12T11:00:00.000Z"),
      },
    ]);

    const req = new NextRequest("http://localhost:3000/api/admin/users", {
      method: "DELETE",
      body: JSON.stringify({ userId: "admin-2" }),
      headers: { "content-type": "application/json" },
    });

    const response = await DELETE(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.role).toBe("user");
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        isPrimaryAdmin: false,
      }),
    );
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
    mockSelectQueue.push([
      {
        id: "admin-1",
        username: "root-admin",
        email: "root@example.com",
        role: "admin",
        isPrimaryAdmin: true,
      },
    ]);

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
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});