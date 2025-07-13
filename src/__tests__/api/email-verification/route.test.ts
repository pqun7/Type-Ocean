/**
 * Tests for email verification functionality
 */

import { verifyEmail } from "@/actions/verify-email";
import { mockPrisma, resetAllMocks } from "@/__tests__/helpers/test-utils";
import bcrypt from "bcrypt";

// Mock dependencies
jest.mock("@/features/auth/lib/db", () => mockPrisma);
jest.mock("bcrypt");

const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe("Email Verification", () => {
  beforeEach(() => {
    resetAllMocks();
    jest.clearAllMocks();
  });

  describe("verifyEmail action", () => {
    it("should verify email with valid token", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        emailVerified: null,
        emailVerifyToken: "hashed-token",
        emailVerifyTokenExpiry: new Date(Date.now() + 3600000), // 1 hour from now
        emailVerificationAttempts: 0,
      };

      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockBcrypt.compare.mockResolvedValue(true);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        emailVerified: new Date(),
        emailVerifyToken: null,
        emailVerifyTokenExpiry: null,
      });

      const result = await verifyEmail("valid-token");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Email verified successfully");
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: {
          emailVerified: expect.any(Date),
          emailVerifyToken: null,
          emailVerifyTokenExpiry: null,
          emailVerificationAttempts: 0,
        },
      });
    });

    it("should reject invalid token", async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await verifyEmail("invalid-token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid or expired verification token");
    });

    it("should reject expired token", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        emailVerified: null,
        emailVerifyToken: "hashed-token",
        emailVerifyTokenExpiry: new Date(Date.now() - 3600000), // 1 hour ago
        emailVerificationAttempts: 0,
      };

      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      const result = await verifyEmail("expired-token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid or expired verification token");
    });

    it("should handle already verified email", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        emailVerified: new Date(),
        emailVerifyToken: "hashed-token",
        emailVerifyTokenExpiry: new Date(Date.now() + 3600000),
        emailVerificationAttempts: 0,
      };

      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      const result = await verifyEmail("some-token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Email is already verified");
    });

    it("should track verification attempts", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        emailVerified: null,
        emailVerifyToken: "hashed-token",
        emailVerifyTokenExpiry: new Date(Date.now() + 3600000),
        emailVerificationAttempts: 2,
      };

      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockBcrypt.compare.mockResolvedValue(false);
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        emailVerificationAttempts: 3,
      });

      const result = await verifyEmail("wrong-token");

      expect(result.success).toBe(false);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: {
          emailVerificationAttempts: 3,
        },
      });
    });

    it("should lock account after too many attempts", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        emailVerified: null,
        emailVerifyToken: "hashed-token",
        emailVerifyTokenExpiry: new Date(Date.now() + 3600000),
        emailVerificationAttempts: 4,
      };

      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      const result = await verifyEmail("any-token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Too many verification attempts. Please request a new verification email.");
    });

    it("should handle database errors", async () => {
      mockPrisma.user.findFirst.mockRejectedValue(new Error("Database error"));

      const result = await verifyEmail("some-token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("An error occurred during verification");
    });
  });

  describe("Email Verification Rate Limiting", () => {
    it("should enforce rate limits on verification attempts", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        emailVerified: null,
        emailVerifyToken: "hashed-token",
        emailVerifyTokenExpiry: new Date(Date.now() + 3600000),
        emailVerificationAttempts: 0,
      };

      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockBcrypt.compare.mockResolvedValue(false);

      // محاولة عدة تحققات متتالية
      for (let i = 0; i < 5; i++) {
        mockPrisma.user.update.mockResolvedValue({
          ...mockUser,
          emailVerificationAttempts: i + 1,
        });

        const result = await verifyEmail("wrong-token");
        
        if (i < 4) {
          expect(result.success).toBe(false);
          expect(result.error).toBe("Invalid verification token");
        } else {
          expect(result.success).toBe(false);
          expect(result.error).toBe("Too many verification attempts. Please request a new verification email.");
        }
      }
    });
  });

  describe("Token Security", () => {
    it("should use secure token comparison", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        emailVerified: null,
        emailVerifyToken: "hashed-token",
        emailVerifyTokenExpiry: new Date(Date.now() + 3600000),
        emailVerificationAttempts: 0,
      };

      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockBcrypt.compare.mockResolvedValue(true);

      await verifyEmail("plain-token");

      expect(mockBcrypt.compare).toHaveBeenCalledWith("plain-token", "hashed-token");
    });

    it("should handle timing attack prevention", async () => {
      // محاكاة عدم وجود مستخدم
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const startTime = Date.now();
      await verifyEmail("non-existent-token");
      const endTime = Date.now();

      // التأكد من أن الوقت المستغرق ليس قصيراً جداً (منع timing attacks)
      expect(endTime - startTime).toBeGreaterThan(50);
    });
  });
});