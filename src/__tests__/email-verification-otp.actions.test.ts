/** @jest-environment node */

import { requestEmailVerificationOtp } from "@/actions/email-verification-otp";
import { verifyEmailOtp } from "@/actions/verify-email-otp";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendVerificationOtpEmail } from "@/features/auth/providers/nodemailer";

const mockSelectQueue: unknown[][] = [];

var mockDb: {
  select: jest.Mock;
  selectFrom: jest.Mock;
  selectWhere: jest.Mock;
  selectLimit: jest.Mock;
  update: jest.Mock;
  updateSet: jest.Mock;
  updateWhere: jest.Mock;
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
    };

    mockDb.selectWhere.mockReturnValue({ limit: mockDb.selectLimit });
    mockDb.selectFrom.mockReturnValue({ where: mockDb.selectWhere });
    mockDb.select.mockReturnValue({ from: mockDb.selectFrom });
    mockDb.updateSet.mockReturnValue({ where: mockDb.updateWhere });
    mockDb.update.mockReturnValue({ set: mockDb.updateSet });

    return {
      select: mockDb.select,
      update: mockDb.update,
    };
  })(),
}));

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock("@/features/auth/providers/nodemailer", () => ({
  sendVerificationOtpEmail: jest.fn(),
}));

jest.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => {
      if (key.toLowerCase() === "x-forwarded-for") {
        return "203.0.113.10";
      }

      return null;
    },
  }),
}));

jest.mock("@/log/ServerLogger", () => ({
  logging: {
    debugSensitive: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto");
  return {
    ...actual,
    randomInt: jest.fn(),
  };
});

describe("email verification OTP actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectQueue.length = 0;
    mockDb.updateWhere.mockReset();
    mockDb.updateSet.mockClear();

    (checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: true,
      headers: {},
    });
    (sendVerificationOtpEmail as jest.Mock).mockResolvedValue({ success: true });
  });

  describe("requestEmailVerificationOtp", () => {
    it("returns NOT_AUTHENTICATED when session is missing", async () => {
      (auth as jest.Mock).mockResolvedValue(null);

      const result = await requestEmailVerificationOtp();

      expect(result).toEqual({ success: false, error: "NOT_AUTHENTICATED" });
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("returns TOO_MANY_REQUESTS when rate limited", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });
      (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false, headers: {} });

      const result = await requestEmailVerificationOtp();

      expect(result).toEqual({ success: false, error: "TOO_MANY_REQUESTS" });
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("returns OTP_COOLDOWN with retryAfterSeconds during cooldown", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });
      mockSelectQueue.push([
        {
          id: "u1",
          email: "old@example.com",
          pendingEmail: "new@example.com",
          emailVerified: null,
          emailVerifyOtpSentAt: new Date(Date.now() - 10_000),
        },
      ]);

      const result = await requestEmailVerificationOtp();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("OTP_COOLDOWN");
        expect("retryAfterSeconds" in result ? result.retryAfterSeconds : 0).toBeGreaterThan(0);
      }
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(sendVerificationOtpEmail).not.toHaveBeenCalled();
    });

    it("sends OTP and stores hashed OTP for pendingEmail destination", async () => {
      const { randomInt } = jest.requireMock("crypto") as { randomInt: jest.Mock };
      randomInt.mockReturnValue(123);

      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });
      mockSelectQueue.push([
        {
          id: "u1",
          email: "old@example.com",
          pendingEmail: "new@example.com",
          emailVerified: null,
          emailVerifyOtpSentAt: null,
        },
      ]);
      mockDb.updateWhere.mockResolvedValue(undefined);

      const result = await requestEmailVerificationOtp();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.sentAt).toBe("string");
      }

      const updateData = mockDb.updateSet.mock.calls[0]?.[0];
      expect(updateData.emailVerifyOtpHash).toEqual(expect.any(String));
      expect(updateData.emailVerifyOtpExpiry).toBeInstanceOf(Date);
      expect(updateData.emailVerifyOtpSentAt).toBeInstanceOf(Date);
      expect(updateData.emailVerifyOtpFailedAttempts).toBe(0);
      expect(sendVerificationOtpEmail).toHaveBeenCalledWith(
        "new@example.com",
        "000123",
        expect.any(Number),
      );
    });
  });

  describe("verifyEmailOtp", () => {
    it("rejects invalid code format", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });

      const formData = new FormData();
      formData.set("code", "12ab");
      formData.set("redirect", "false");

      const result = await verifyEmailOtp({ success: false, error: null }, formData);

      expect(result).toEqual({ success: false, error: "INVALID_CODE" });
    });

    it("on expired OTP: clears OTP and cancels any in-progress email change", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });
      mockSelectQueue.push([
        {
          id: "u1",
          email: "old@example.com",
          pendingEmail: "new@example.com",
          emailVerified: null,
          emailVerifyOtpHash: "deadbeef",
          emailVerifyOtpExpiry: new Date(Date.now() - 1000),
          emailVerifyOtpFailedAttempts: 0,
        },
      ]);
      mockDb.updateWhere.mockResolvedValue(undefined);

      const formData = new FormData();
      formData.set("code", "000123");
      formData.set("redirect", "false");

      const result = await verifyEmailOtp({ success: false, error: null }, formData);

      expect(result).toEqual({ success: false, error: "OTP_EXPIRED" });

      const updateData = mockDb.updateSet.mock.calls[0]?.[0];
      expect(updateData.pendingEmail).toBeNull();
      expect(updateData.pendingEmailRequestedAt).toBeNull();
      expect(updateData.emailVerifyOtpHash).toBeNull();
      expect(updateData.emailVerifyOtpExpiry).toBeNull();
      expect(updateData.emailVerifyOtpSentAt).toBeNull();
      expect(updateData.emailVerifyOtpFailedAttempts).toBe(0);
    });

    it("on too many attempts: cancels request and clears OTP state", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });
      mockSelectQueue.push([
        {
          id: "u1",
          email: "old@example.com",
          pendingEmail: "new@example.com",
          emailVerified: null,
          emailVerifyOtpHash: "00".repeat(32),
          emailVerifyOtpExpiry: new Date(Date.now() + 10 * 60 * 1000),
          emailVerifyOtpFailedAttempts: 4,
        },
      ]);
      mockDb.updateWhere.mockResolvedValue(undefined);

      const formData = new FormData();
      formData.set("code", "999999");
      formData.set("redirect", "false");

      const result = await verifyEmailOtp({ success: false, error: null }, formData);

      expect(result).toEqual({ success: false, error: "TOO_MANY_ATTEMPTS" });

      const updateData = mockDb.updateSet.mock.calls[0]?.[0];
      expect(updateData.pendingEmail).toBeNull();
      expect(updateData.emailVerifyOtpHash).toBeNull();
      expect(updateData.emailVerifyOtpFailedAttempts).toBe(0);
    });

    it("verifies OTP (redirect=false) and applies pending email", async () => {
      const { createHash } = jest.requireActual("crypto") as typeof import("crypto");
      const pepper = (process.env.EMAIL_OTP_PEPPER || "").trim();
      const code = "000123";
      const expectedHash = createHash("sha256").update(`u1:${code}:${pepper}`).digest("hex");

      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });
      mockSelectQueue.push([
        {
          id: "u1",
          email: "old@example.com",
          pendingEmail: "new@example.com",
          emailVerified: null,
          emailVerifyOtpHash: expectedHash,
          emailVerifyOtpExpiry: new Date(Date.now() + 10 * 60 * 1000),
          emailVerifyOtpFailedAttempts: 0,
        },
      ]);
      mockSelectQueue.push([]);
      mockDb.updateWhere.mockResolvedValue(undefined);

      const formData = new FormData();
      formData.set("code", code);
      formData.set("redirect", "false");

      const result = await verifyEmailOtp({ success: false, error: null }, formData);

      expect(result).toEqual({ success: true, error: null });

      const updateData = mockDb.updateSet.mock.calls[0]?.[0];
      expect(updateData.email).toBe("new@example.com");
      expect(updateData.pendingEmail).toBeNull();
      expect(updateData.emailVerifyOtpHash).toBeNull();
      expect(updateData.emailVerified).toBeInstanceOf(Date);
    });

    it("returns EMAIL_ALREADY_IN_USE when destination email conflicts", async () => {
      const { createHash } = jest.requireActual("crypto") as typeof import("crypto");
      const pepper = (process.env.EMAIL_OTP_PEPPER || "").trim();
      const code = "000123";
      const expectedHash = createHash("sha256").update(`u1:${code}:${pepper}`).digest("hex");

      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });
      mockSelectQueue.push([
        {
          id: "u1",
          email: "old@example.com",
          pendingEmail: "new@example.com",
          emailVerified: null,
          emailVerifyOtpHash: expectedHash,
          emailVerifyOtpExpiry: new Date(Date.now() + 10 * 60 * 1000),
          emailVerifyOtpFailedAttempts: 0,
        },
      ]);
      mockSelectQueue.push([{ id: "other" }]);

      const formData = new FormData();
      formData.set("code", code);
      formData.set("redirect", "false");

      const result = await verifyEmailOtp({ success: false, error: null }, formData);

      expect(result).toEqual({ success: false, error: "EMAIL_ALREADY_IN_USE" });
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
