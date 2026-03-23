/** @jest-environment node */

import bcrypt from "bcryptjs";

import { resetPassword, updatePassword } from "@/actions/reset-password";
import { checkRateLimit } from "@/lib/rate-limiter";
import { sendPasswordResetEmail } from "@/features/auth/providers/nodemailer";
import { generateResetToken, validateResetToken } from "@/features/auth/utils/tokens";
import { saltAndHashPassword } from "@/features/auth/utils/password";

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
      selectLimit: jest.fn(),
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

describe("password reset server actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.selectLimit.mockReset();
    mockDb.updateWhere.mockReset();
    mockDb.updateSet.mockClear();

    (checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: true,
      headers: {},
    });
    (sendPasswordResetEmail as jest.Mock).mockResolvedValue({ success: true });
    (generateResetToken as jest.Mock).mockResolvedValue("raw-reset-token");
    (saltAndHashPassword as jest.Mock).mockResolvedValue("new-hash");
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
  });

  it("resetPassword returns success even if user not found (no enumeration)", async () => {
    mockDb.selectLimit.mockResolvedValue([]);

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
    mockDb.selectLimit.mockResolvedValue([{ id: "u1", passwordHash: null }]);

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
    mockDb.updateWhere.mockResolvedValue(undefined);

    const formData = new FormData();
    formData.set("token", "raw-reset-token");
    formData.set("password", "NewPassw0rd");
    formData.set("confirmPassword", "NewPassw0rd");

    const result = await updatePassword({ success: false, error: null }, formData);

    expect(result).toEqual({ success: true });
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.updateWhere).toHaveBeenCalledTimes(1);

    const updateData = mockDb.updateSet.mock.calls[0]?.[0];
    expect(updateData.resetToken).toBeNull();
    expect(updateData.resetTokenExpiry).toBeNull();
    expect(updateData.passwordHash).toBe("new-hash");
    expect(updateData.passwordResetRequests).toBeUndefined();
    expect(updateData.emailVerifyToken).toBeNull();
    expect(updateData.emailVerifyTokenExpiry).toBeNull();
    expect(updateData.emailVerified).toBeInstanceOf(Date);
    expect(updateData.emailVerificationAttempts).toBe(0);
  });

  it("updatePassword does not overwrite emailVerified if already verified", async () => {
    const verifiedAt = new Date("2024-01-01T00:00:00.000Z");

    (validateResetToken as jest.Mock).mockResolvedValue({
      id: "u4",
      email: "verified@example.com",
      passwordHash: "old-hash",
      emailVerified: verifiedAt,
    });
    mockDb.updateWhere.mockResolvedValue(undefined);

    const formData = new FormData();
    formData.set("token", "raw-reset-token");
    formData.set("password", "NewPassw0rd");
    formData.set("confirmPassword", "NewPassw0rd");

    const result = await updatePassword({ success: false, error: null }, formData);

    expect(result).toEqual({ success: true });

    const updateData = mockDb.updateSet.mock.calls[0]?.[0];
    expect(updateData.emailVerified).toBeUndefined();
    expect(updateData.emailVerifyToken).toBeNull();
    expect(updateData.emailVerifyTokenExpiry).toBeNull();
  });

  it("updatePassword rejects reusing the current password", async () => {
    (validateResetToken as jest.Mock).mockResolvedValue({
      id: "u3",
      email: "user@example.com",
      passwordHash: "old-hash",
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const formData = new FormData();
    formData.set("token", "raw-reset-token");
    formData.set("password", "OldPassw0rd");
    formData.set("confirmPassword", "OldPassw0rd");

    const result = await updatePassword({ success: false, error: null }, formData);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/different from the current password/i);
    expect(mockDb.update).not.toHaveBeenCalled();
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
