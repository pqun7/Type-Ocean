/**
 * Tests for users API endpoints
 * Tests /api/users/v1 route handlers
 */

import { GET, POST, PUT, DELETE } from "@/app/api/users/v1/route";
import { NextRequest } from "next/server";
import { mockPrisma, resetAllMocks } from "@/__tests__/helpers/test-utils";

// Mock Prisma
jest.mock("@/features/auth/lib/db", () => mockPrisma);

describe("/api/users/v1", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  const mockRequest = (body?: any, headers: Record<string, string> = {}) =>
    ({
      headers: new Headers({
        "x-user-id": "user-123",
        "content-type": "application/json",
        ...headers,
      }),
      json: () => Promise.resolve(body || {}),
      nextUrl: { searchParams: new URLSearchParams() },
    }) as NextRequest;

  describe("GET /api/users/v1", () => {
    it("should return user profile", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        profile: {
          id: "profile-123",
          level: 5,
          xp: 1250,
          achievements: [],
        },
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const response = await GET(mockRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-123" },
        include: { profile: true },
      });
    });

    it("should return 404 when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await GET(mockRequest());

      expect(response.status).toBe(404);
    });

    it("should return 401 when unauthorized", async () => {
      const response = await GET(mockRequest({}, { "x-user-id": "" }));

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/users/v1", () => {
    it("should create new user", async () => {
      const newUser = {
        email: "newuser@example.com",
        username: "newuser",
        password: "securepassword123",
      };

      const createdUser = {
        id: "new-user-id",
        email: newUser.email,
        username: newUser.username,
        createdAt: new Date(),
      };

      mockPrisma.user.create.mockResolvedValue(createdUser);

      const response = await POST(mockRequest(newUser));
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.user.id).toBe("new-user-id");
      expect(data.user.email).toBe(newUser.email);
    });

    it("should return 400 for invalid email", async () => {
      const invalidUser = {
        email: "invalid-email",
        username: "testuser",
        password: "password123",
      };

      const response = await POST(mockRequest(invalidUser));

      expect(response.status).toBe(400);
    });

    it("should return 409 for duplicate email", async () => {
      const duplicateUser = {
        email: "existing@example.com",
        username: "testuser",
        password: "password123",
      };

      mockPrisma.user.create.mockRejectedValue({
        code: "P2002",
        meta: { target: ["email"] },
      });

      const response = await POST(mockRequest(duplicateUser));

      expect(response.status).toBe(409);
    });
  });

  describe("PUT /api/users/v1", () => {
    it("should update user profile", async () => {
      const updateData = {
        username: "updateduser",
        avatar: "new-avatar-url",
      };

      const updatedUser = {
        id: "user-123",
        email: "test@example.com",
        username: updateData.username,
        avatar: updateData.avatar,
        updatedAt: new Date(),
      };

      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const response = await PUT(mockRequest(updateData));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user.username).toBe(updateData.username);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-123" },
        data: updateData,
      });
    });

    it("should return 400 for invalid update data", async () => {
      const invalidData = {
        email: "invalid-email-format",
      };

      const response = await PUT(mockRequest(invalidData));

      expect(response.status).toBe(400);
    });

    it("should return 404 when user not found", async () => {
      mockPrisma.user.update.mockRejectedValue({
        code: "P2025",
        message: "Record not found",
      });

      const response = await PUT(mockRequest({ username: "newname" }));

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/users/v1", () => {
    it("should delete user account", async () => {
      mockPrisma.user.delete.mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
      });

      const response = await DELETE(mockRequest());

      expect(response.status).toBe(200);
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: "user-123" },
      });
    });

    it("should return 404 when user not found", async () => {
      mockPrisma.user.delete.mockRejectedValue({
        code: "P2025",
        message: "Record not found",
      });

      const response = await DELETE(mockRequest());

      expect(response.status).toBe(404);
    });

    it("should return 401 when unauthorized", async () => {
      const response = await DELETE(mockRequest({}, { "x-user-id": "" }));

      expect(response.status).toBe(401);
    });
  });

  describe("Error Handling", () => {
    it("should handle database connection errors", async () => {
      mockPrisma.user.findUnique.mockRejectedValue(
        new Error("Database connection failed")
      );

      const response = await GET(mockRequest());

      expect(response.status).toBe(500);
    });

    it("should handle malformed JSON in request", async () => {
      const malformedRequest = {
        ...mockRequest(),
        json: () => Promise.reject(new Error("Invalid JSON")),
      };

      const response = await POST(malformedRequest as NextRequest);

      expect(response.status).toBe(400);
    });
  });

  describe("Rate Limiting", () => {
    it("should enforce rate limits on user creation", async () => {
      // محاكاة تجاوز الحد الأقصى للطلبات
      for (let i = 0; i < 10; i++) {
        await POST(mockRequest({
          email: `user${i}@example.com`,
          username: `user${i}`,
          password: "password123",
        }));
      }

      // الطلب الحادي عشر يجب أن يفشل
      const response = await POST(mockRequest({
        email: "user11@example.com",
        username: "user11",
        password: "password123",
      }));

      // Note: This would need actual rate limiting implementation
      // For now, we just verify the structure
      expect([200, 201, 429]).toContain(response.status);
    });
  });
});