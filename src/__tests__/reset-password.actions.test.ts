/** @jest-environment node */

import { resetPassword, updatePassword } from "@/actions/reset-password";

import dbClient from "@/features/auth/lib/db";
import { generateResetToken, validateResetToken } from "@/features/auth/utils/tokens";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendPasswordResetEmail } from "@/features/auth/providers/nodemailer";
import { saltAndHashPassword } from "@/features/auth/utils/password";
import bcrypt from "bcryptjs";

type DbMock = {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

const dbMock = dbClient as unknown as DbMock;

jest.mock("@/features/auth/lib/db", () => {
  const dbMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  return {
    __esModule: true,
    default: dbMock,
  };
});

jest.mock("@/features/auth/utils/tokens", () => ({
  generateResetToken: jest.fn(),
  validateResetToken: jest.fn(),
}));

jest.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock("@/features/auth/providers/nodemailer", () => ({
  sendPasswordResetEmail: jest.fn(),
}));

jest.mock("@/features/auth/utils/password", () => ({
  saltAndHashPassword: jest.fn(),
}));

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
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

describe("password reset server actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    dbMock.$transaction.mockImplementation(async (ops: Array<unknown>) => {
      // DB transaction mock accepts an array of promises; resolve them here.
      return Promise.all(ops as Array<Promise<unknown>>);
    });

    (checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: true,
      headers: {},
    });

    (sendPasswordResetEmail as jest.Mock).mockResolvedValue({
      success: true,
    });

    (generateResetToken as jest.Mock).mockResolvedValue("raw-reset-token");

    (saltAndHashPassword as jest.Mock).mockResolvedValue("new-hash");

    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
  });

  it("resetPassword returns success even if user not found (no enumeration)", async () => {
    dbMock.user.findUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.set("email", "missing@example.com");

    const result = await resetPassword({ success: false, error: null }, formData);

    expect(result).toEqual({ success: true });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(generateResetToken).not.toHaveBeenCalled();
  });

  it("resetPassword blocks when rate limited", async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false, headers: {} });

    const formData = new FormData();
    formData.set("email", "user@example.com");

    const result = await resetPassword({ success: false, error: null }, formData);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too many requests/i);
  });

  it("resetPassword does not send email for social auth account (no passwordHash)", async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: "u1", passwordHash: null });

    const formData = new FormData();
    formData.set("email", "social@example.com");

    const result = await resetPassword({ success: false, error: null }, formData);

    expect(result).toEqual({ success: true });
    expect(generateResetToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("updatePassword updates hash and clears reset token once", async () => {
    (validateResetToken as jest.Mock).mockResolvedValue({
      id: "u2",
      email: "user@example.com",
      passwordHash: "old-hash",
      emailVerified: null,
    });

    dbMock.user.update.mockResolvedValue({ id: "u2" });

    const formData = new FormData();
    formData.set("token", "raw-reset-token");
    formData.set("password", "NewPassw0rd");
    formData.set("confirmPassword", "NewPassw0rd");

    const result = await updatePassword({ success: false, error: null }, formData);

    expect(result).toEqual({ success: true });
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(dbMock.user.update).toHaveBeenCalledTimes(1);

    const updateArgs = dbMock.user.update.mock.calls[0]?.[0];
    expect(updateArgs.where).toEqual({ id: "u2" });
    expect(updateArgs.data.resetToken).toBeNull();
    expect(updateArgs.data.resetTokenExpiry).toBeNull();
    expect(updateArgs.data.passwordHash).toBe("new-hash");
    expect(updateArgs.data.passwordResetRequests).toBeUndefined();

    expect(updateArgs.data.emailVerifyToken).toBeNull();
    expect(updateArgs.data.emailVerifyTokenExpiry).toBeNull();
    expect(updateArgs.data.emailVerified).toBeInstanceOf(Date);
    expect(updateArgs.data.emailVerificationAttempts).toBe(0);
  });

  it("updatePassword does not overwrite emailVerified if already verified", async () => {
    const verifiedAt = new Date("2024-01-01T00:00:00.000Z");

    (validateResetToken as jest.Mock).mockResolvedValue({
      id: "u4",
      email: "verified@example.com",
      passwordHash: "old-hash",
      emailVerified: verifiedAt,
    });

    dbMock.user.update.mockResolvedValue({ id: "u4" });

    const formData = new FormData();
    formData.set("token", "raw-reset-token");
    formData.set("password", "NewPassw0rd");
    formData.set("confirmPassword", "NewPassw0rd");

    const result = await updatePassword({ success: false, error: null }, formData);
    expect(result).toEqual({ success: true });

    const updateArgs = dbMock.user.update.mock.calls[0]?.[0];
    // emailVerified should be omitted (undefined) when already verified.
    expect(updateArgs.data.emailVerified).toBeUndefined();
    expect(updateArgs.data.emailVerifyToken).toBeNull();
    expect(updateArgs.data.emailVerifyTokenExpiry).toBeNull();
  });

  it("updatePassword rejects reusing the current password", async () => {
    (validateResetToken as jest.Mock).mockResolvedValue({
      id: "u3",
      email: "user@example.com",
      passwordHash: "old-hash",
    });

    (bcrypt.compare as jest.Mock).mockResolvedValue(true); // newPassword matches old hash

    const formData = new FormData();
    formData.set("token", "raw-reset-token");
    formData.set("password", "OldPassw0rd");
    formData.set("confirmPassword", "OldPassw0rd");

    const result = await updatePassword({ success: false, error: null }, formData);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/different from the current password/i);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("updatePassword fails cleanly when token is missing", async () => {
    const formData = new FormData();
    formData.set("password", "NewPassw0rd");
    formData.set("confirmPassword", "NewPassw0rd");

    const result = await updatePassword({ success: false, error: null }, formData);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/reset link is invalid or has expired/i);
  });
});
