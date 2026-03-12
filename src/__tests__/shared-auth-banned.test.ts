/** @jest-environment node */

import { NextRequest } from "next/server";
import { authorizeRequest, resolveExistingUserId } from "@/app/api/shared.server";
import prisma from "@/features/auth/lib/db";
import { getToken } from "next-auth/jwt";

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
  };
};

const prismaMock = prisma as unknown as PrismaMock;

jest.mock("server-only", () => ({}));

jest.mock("@/features/auth/lib/db", () => {
  const prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
  };

  return {
    __esModule: true,
    default: prismaMock,
  };
});

jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn(),
}));

jest.mock("@/lib/redis", () => ({
  redis: {},
  connectIfNeeded: jest.fn(),
}));

jest.mock("@/features/auth/utils/timeUtils", () => ({
  getTodayDate: jest.fn(() => "2026-03-11"),
  getUtcMidnightTTL: jest.fn(() => 3600),
}));

jest.mock("@/log/ServerLogger", () => ({
  logging: {
    debugSensitive: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

describe("shared auth guards for banned users", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolveExistingUserId returns null for banned users", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u-banned", banned: true });

    await expect(resolveExistingUserId("u-banned")).resolves.toBeNull();
  });

  it("authorizeRequest rejects a banned user from NextAuth token resolution", async () => {
    (getToken as jest.Mock).mockResolvedValue({ id: "u-banned" });
    prismaMock.user.findUnique.mockResolvedValue({ id: "u-banned", banned: true });

    const req = new NextRequest("http://localhost:3000/api/profile/progress");

    await expect(authorizeRequest(req)).resolves.toBeNull();
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it("authorizeRequest allows an existing non-banned user", async () => {
    (getToken as jest.Mock).mockResolvedValue({ id: "u-ok" });
    prismaMock.user.findUnique.mockResolvedValue({ id: "u-ok", banned: false });

    const req = new NextRequest("http://localhost:3000/api/profile/progress");

    await expect(authorizeRequest(req)).resolves.toBe("u-ok");
  });
});