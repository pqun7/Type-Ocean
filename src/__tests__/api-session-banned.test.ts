/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET } from "@/app/api/session/route";
import { getToken } from "next-auth/jwt";

jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn(),
}));

jest.mock("@/app/api/shared.server", () => ({
  resolveExistingUserId: jest.fn(),
}));

describe("api/session banned session handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("clears auth cookies and returns banned when Auth.js invalidates a banned user", async () => {
    (getToken as jest.Mock).mockResolvedValue({
      invalidUser: true,
      invalidUserReason: "banned",
    });

    const req = new NextRequest("http://localhost:3000/api/session");
    const response = await GET(req);
    const body = await response.json();
    const setCookieHeader = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(body).toEqual({ valid: false, reason: "banned" });
    expect(setCookieHeader).toContain("jwt=");
    expect(setCookieHeader).toContain("Max-Age=0");
  });
});