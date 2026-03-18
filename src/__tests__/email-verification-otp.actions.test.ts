/** @jest-environment node */

import { requestEmailVerificationOtp } from "@/actions/email-verification-otp";
import { verifyEmailOtp } from "@/actions/verify-email-otp";

import dbClient from "@/features/auth/lib/db";
import { auth } from "@/features/auth/lib/auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendVerificationOtpEmail } from "@/features/auth/providers/nodemailer";

type DbMock = {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
  };
};

const dbMock = dbClient as unknown as DbMock;

jest.mock("@/features/auth/lib/db", () => {
  const dbMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  return {
    __esModule: true,
    default: dbMock,
  };
});

jest.mock("@/features/auth/lib/auth", () => ({
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
      if (key.toLowerCase() === "x-forwarded-for") return "203.0.113.10";
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

    (checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: true,
      headers: {},
    });

    (sendVerificationOtpEmail as jest.Mock).mockResolvedValue({
      success: true,
    });
  });

  describe("requestEmailVerificationOtp", () => {
    it("returns NOT_AUTHENTICATED when session is missing", async () => {
      (auth as jest.Mock).mockResolvedValue(null);

      const result = await requestEmailVerificationOtp();

      expect(result).toEqual({ success: false, error: "NOT_AUTHENTICATED" });
      expect(dbMock.user.findUnique).not.toHaveBeenCalled();
    });

    it("returns TOO_MANY_REQUESTS when rate limited", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });
      (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false, headers: {} });

      const result = await requestEmailVerificationOtp();

      expect(result).toEqual({ success: false, error: "TOO_MANY_REQUESTS" });
      expect(dbMock.user.findUnique).not.toHaveBeenCalled();
    });

    it("returns OTP_COOLDOWN with retryAfterSeconds during cooldown", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });

      const sentAt = new Date(Date.now() - 10_000); // 10s ago
      dbMock.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "old@example.com",
        pendingEmail: "new@example.com",
        emailVerified: null,
        emailVerifyOtpSentAt: sentAt,
      });

      const result = await requestEmailVerificationOtp();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("OTP_COOLDOWN");
        expect("retryAfterSeconds" in result ? result.retryAfterSeconds : 0).toBeGreaterThan(0);
      }
      expect(dbMock.user.update).not.toHaveBeenCalled();
      expect(sendVerificationOtpEmail).not.toHaveBeenCalled();
    });

    it("sends OTP and stores hashed OTP for pendingEmail destination", async () => {
      const { randomInt } = jest.requireMock("crypto") as { randomInt: jest.Mock };
      randomInt.mockReturnValue(123); // => 000123

      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });
      dbMock.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "old@example.com",
        pendingEmail: "new@example.com",
        emailVerified: null,
        emailVerifyOtpSentAt: null,
      });

      dbMock.user.update.mockResolvedValue({ id: "u1" });

      const result = await requestEmailVerificationOtp();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.sentAt).toBe("string");
      }

      expect(dbMock.user.update).toHaveBeenCalledTimes(1);
      const updateArgs = dbMock.user.update.mock.calls[0]?.[0];
      expect(updateArgs.where).toEqual({ id: "u1" });
      expect(updateArgs.data.emailVerifyOtpHash).toEqual(expect.any(String));
      expect(updateArgs.data.emailVerifyOtpExpiry).toBeInstanceOf(Date);
      expect(updateArgs.data.emailVerifyOtpSentAt).toBeInstanceOf(Date);
      expect(updateArgs.data.emailVerifyOtpFailedAttempts).toBe(0);

      expect(sendVerificationOtpEmail).toHaveBeenCalledTimes(1);
      expect(sendVerificationOtpEmail).toHaveBeenCalledWith(
        "new@example.com",
        "000123",
        expect.any(Number)
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

      dbMock.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "old@example.com",
        pendingEmail: "new@example.com",
        emailVerified: null,
        emailVerifyOtpHash: "deadbeef",
        emailVerifyOtpExpiry: new Date(Date.now() - 1000),
        emailVerifyOtpFailedAttempts: 0,
      });

      dbMock.user.update.mockResolvedValue({ id: "u1" });

      const formData = new FormData();
      formData.set("code", "000123");
      formData.set("redirect", "false");

      const result = await verifyEmailOtp({ success: false, error: null }, formData);

      expect(result).toEqual({ success: false, error: "OTP_EXPIRED" });
      expect(dbMock.user.update).toHaveBeenCalledTimes(1);

      const updateArgs = dbMock.user.update.mock.calls[0]?.[0];
      expect(updateArgs.where).toEqual({ id: "u1" });
      expect(updateArgs.data.pendingEmail).toBeNull();
      expect(updateArgs.data.pendingEmailRequestedAt).toBeNull();
      expect(updateArgs.data.emailVerifyOtpHash).toBeNull();
      expect(updateArgs.data.emailVerifyOtpExpiry).toBeNull();
      expect(updateArgs.data.emailVerifyOtpSentAt).toBeNull();
      expect(updateArgs.data.emailVerifyOtpFailedAttempts).toBe(0);
    });

    it("on too many attempts: cancels request and clears OTP state", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });

      dbMock.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "old@example.com",
        pendingEmail: "new@example.com",
        emailVerified: null,
        emailVerifyOtpHash: "00".repeat(32),
        emailVerifyOtpExpiry: new Date(Date.now() + 10 * 60 * 1000),
        emailVerifyOtpFailedAttempts: 4,
      });

      dbMock.user.update.mockResolvedValue({ id: "u1" });

      const formData = new FormData();
      formData.set("code", "999999");
      formData.set("redirect", "false");

      const result = await verifyEmailOtp({ success: false, error: null }, formData);

      expect(result).toEqual({ success: false, error: "TOO_MANY_ATTEMPTS" });

      // When lockout triggers, it should clear OTP + pending email.
      const updateArgs = dbMock.user.update.mock.calls[0]?.[0];
      expect(updateArgs.data.pendingEmail).toBeNull();
      expect(updateArgs.data.emailVerifyOtpHash).toBeNull();
      expect(updateArgs.data.emailVerifyOtpFailedAttempts).toBe(0);
    });

    it("verifies OTP (redirect=false) and applies pending email", async () => {
      const { createHash } = jest.requireActual("crypto") as typeof import("crypto");
      const pepper = (process.env.EMAIL_OTP_PEPPER || "").trim();
      const code = "000123";

      const expectedHash = createHash("sha256")
        .update(`u1:${code}:${pepper}`)
        .digest("hex");

      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });

      dbMock.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "old@example.com",
        pendingEmail: "new@example.com",
        emailVerified: null,
        emailVerifyOtpHash: expectedHash,
        emailVerifyOtpExpiry: new Date(Date.now() + 10 * 60 * 1000),
        emailVerifyOtpFailedAttempts: 0,
      });

      dbMock.user.findFirst.mockResolvedValue(null);
      dbMock.user.update.mockResolvedValue({ id: "u1" });

      const formData = new FormData();
      formData.set("code", code);
      formData.set("redirect", "false");

      const result = await verifyEmailOtp({ success: false, error: null }, formData);

      expect(result).toEqual({ success: true, error: null });

      const updateArgs = dbMock.user.update.mock.calls[0]?.[0];
      expect(updateArgs.data.email).toBe("new@example.com");
      expect(updateArgs.data.pendingEmail).toBeNull();
      expect(updateArgs.data.emailVerifyOtpHash).toBeNull();
      expect(updateArgs.data.emailVerified).toBeInstanceOf(Date);
    });

    it("returns EMAIL_ALREADY_IN_USE when destination email conflicts", async () => {
      const { createHash } = jest.requireActual("crypto") as typeof import("crypto");
      const pepper = (process.env.EMAIL_OTP_PEPPER || "").trim();
      const code = "000123";

      const expectedHash = createHash("sha256")
        .update(`u1:${code}:${pepper}`)
        .digest("hex");

      (auth as jest.Mock).mockResolvedValue({ user: { id: "u1" } });

      dbMock.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "old@example.com",
        pendingEmail: "new@example.com",
        emailVerified: null,
        emailVerifyOtpHash: expectedHash,
        emailVerifyOtpExpiry: new Date(Date.now() + 10 * 60 * 1000),
        emailVerifyOtpFailedAttempts: 0,
      });

      dbMock.user.findFirst.mockResolvedValue({ id: "other" });

      const formData = new FormData();
      formData.set("code", code);
      formData.set("redirect", "false");

      const result = await verifyEmailOtp({ success: false, error: null }, formData);

      expect(result).toEqual({ success: false, error: "EMAIL_ALREADY_IN_USE" });
      expect(dbMock.user.update).not.toHaveBeenCalled();
    });
  });
});
