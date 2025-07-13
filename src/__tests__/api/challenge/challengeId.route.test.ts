/**
 * Tests for challenge-specific route handlers
 * Tests /api/challenge/v1/daily/[challengeId] endpoints
 */

import { GET, PUT } from "@/app/api/challenge/v1/daily/[challengeId]/route";
import { NextRequest } from "next/server";
import redis from "@/lib/redis";
import { calculateChallengeStatus } from "@/features/level/utils/challengeHelpers";
import { getTodayDate } from "@/features/auth/utils/timeUtils";

// Mock dependencies
jest.mock("@/lib/redis");
jest.mock("@/features/level/utils/challengeHelpers", () => ({
  calculateChallengeStatus: jest.fn(),
}));
jest.mock("@/features/auth/utils/timeUtils", () => ({
  getTodayDate: jest.fn(() => "2024-01-01"),
  getLocalMidnightTTL: jest.fn(() => 86400),
}));

const mockedRedis = redis as jest.Mocked<typeof redis>;
const mockedCalculateStatus = calculateChallengeStatus as jest.Mock;

describe("/api/challenge/v1/daily/[challengeId] Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCalculateStatus.mockReturnValue(1); // Default to completed
  });

  const mockRequest = (body?: any, headers = {}) =>
    ({
      headers: new Headers({
        "x-user-id": "user-123",
        ...headers,
      }),
      json: () => Promise.resolve(body || {}),
    }) as NextRequest;

  const mockParams = { params: Promise.resolve({ challengeId: "challenge-123" }) };

  describe("GET /api/challenge/v1/daily/[challengeId]", () => {
    it("should return specific challenge by ID", async () => {
      const mockChallenge = {
        id: "challenge-123",
        date: "2024-01-01",
        type: "speedCombo",
        target: { wpm: 80, accuracy: 95 },
        status: 0,
        xp: 150,
        data: {}
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(mockChallenge));

      const response = await GET(mockRequest(), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockChallenge);
      expect(mockedRedis.get).toHaveBeenCalledWith("dailyChallenge:user-123:2024-01-01");
    });

    it("should return 404 when challenge not found", async () => {
      mockedRedis.get.mockResolvedValue(null);

      const response = await GET(mockRequest(), mockParams);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Challenge not found");
    });

    it("should return 404 when challenge ID mismatch", async () => {
      const mockChallenge = {
        id: "different-challenge-id",
        date: "2024-01-01",
        type: "marathon",
        target: 500,
        status: 0,
        xp: 100,
        data: { charactersTyped: 0 }
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(mockChallenge));

      const response = await GET(mockRequest(), mockParams);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Challenge ID mismatch");
    });

    it("should return 401 when unauthorized", async () => {
      const response = await GET(mockRequest({}, { "x-user-id": undefined }), mockParams);
      
      expect(response.status).toBe(401);
    });

    it("should handle Redis errors gracefully", async () => {
      mockedRedis.get.mockRejectedValue(new Error("Redis connection failed"));

      const response = await GET(mockRequest(), mockParams);
      
      expect(response.status).toBe(500);
    });
  });

  describe("PUT /api/challenge/v1/daily/[challengeId]", () => {
    const mockChallenge = {
      id: "challenge-123",
      date: "2024-01-01",
      type: "marathon",
      target: 1000,
      status: 0,
      xp: 200,
      data: { charactersTyped: 250 }
    };

    it("should update marathon challenge progress", async () => {
      mockedRedis.get.mockResolvedValue(JSON.stringify(mockChallenge));
      mockedCalculateStatus.mockReturnValue(-1); // In progress
      mockedRedis.setEx.mockResolvedValue("OK");

      const sessionData = {
        wpm: 75,
        accuracy: 96,
        textLength: 150,
        timeSpent: 120
      };

      const response = await PUT(
        mockRequest({ session: sessionData }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.charactersTyped).toBe(400); // 250 + 150
      expect(data.status).toBe(-1);
      expect(mockedRedis.setEx).toHaveBeenCalled();
    });

    it("should update timeAttack challenge progress", async () => {
      const timeAttackChallenge = {
        ...mockChallenge,
        type: "timeAttack",
        target: 600,
        data: { timeSpent: 300 }
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(timeAttackChallenge));
      mockedCalculateStatus.mockReturnValue(1); // Completed
      mockedRedis.setEx.mockResolvedValue("OK");

      const sessionData = {
        wpm: 80,
        accuracy: 95,
        textLength: 200,
        timeSpent: 350
      };

      const response = await PUT(
        mockRequest({ session: sessionData }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.timeSpent).toBe(650); // 300 + 350
      expect(data.status).toBe(1);
    });

    it("should update speedCombo challenge and complete it", async () => {
      const speedComboChallenge = {
        ...mockChallenge,
        type: "speedCombo",
        target: { wpm: 70, accuracy: 90 },
        data: {}
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(speedComboChallenge));
      mockedRedis.setEx.mockResolvedValue("OK");

      const sessionData = {
        wpm: 75, // Meets target
        accuracy: 92, // Meets target
        textLength: 200,
        timeSpent: 180
      };

      const response = await PUT(
        mockRequest({ session: sessionData }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe(1); // Should be completed
      expect(data.data.finalWpm).toBe(75);
      expect(data.data.finalAccuracy).toBe(92);
      expect(data.data.completedAt).toBeDefined();
    });

    it("should not complete speedCombo if requirements not met", async () => {
      const speedComboChallenge = {
        ...mockChallenge,
        type: "speedCombo",
        target: { wpm: 80, accuracy: 95 },
        data: {}
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(speedComboChallenge));
      mockedRedis.setEx.mockResolvedValue("OK");

      const sessionData = {
        wpm: 75, // Below target
        accuracy: 90, // Below target
        textLength: 200,
        timeSpent: 180
      };

      const response = await PUT(
        mockRequest({ session: sessionData }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe(-1); // Should be in progress
      expect(data.data.bestWpm).toBe(75);
      expect(data.data.bestAccuracy).toBe(90);
    });

    it("should return 400 for invalid request body", async () => {
      const response = await PUT(
        mockRequest({ invalidField: "value" }),
        mockParams
      );
      
      expect(response.status).toBe(400);
    });

    it("should return 400 for invalid session data", async () => {
      const response = await PUT(
        mockRequest({ session: { wpm: "invalid" } }),
        mockParams
      );
      
      expect(response.status).toBe(400);
    });

    it("should return 404 when challenge not found", async () => {
      mockedRedis.get.mockResolvedValue(null);

      const response = await PUT(
        mockRequest({ session: { wpm: 75, accuracy: 95 } }),
        mockParams
      );
      
      expect(response.status).toBe(404);
    });

    it("should return 400 when challenge ID mismatch", async () => {
      const mismatchedChallenge = {
        ...mockChallenge,
        id: "different-id"
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(mismatchedChallenge));

      const response = await PUT(
        mockRequest({ session: { wpm: 75, accuracy: 95 } }),
        mockParams
      );
      
      expect(response.status).toBe(400);
    });

    it("should return 410 when challenge is expired", async () => {
      const expiredChallenge = {
        ...mockChallenge,
        date: "2023-12-31" // Different from mocked "today"
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(expiredChallenge));

      const response = await PUT(
        mockRequest({ session: { wpm: 75, accuracy: 95 } }),
        mockParams
      );
      
      expect(response.status).toBe(410);
    });

    it("should return 401 when unauthorized", async () => {
      const response = await PUT(
        mockRequest({ session: { wpm: 75, accuracy: 95 } }, { "x-user-id": undefined }),
        mockParams
      );
      
      expect(response.status).toBe(401);
    });

    it("should handle unknown challenge type", async () => {
      const unknownTypeChallenge = {
        ...mockChallenge,
        type: "unknownType"
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(unknownTypeChallenge));

      const response = await PUT(
        mockRequest({ session: { wpm: 75, accuracy: 95 } }),
        mockParams
      );
      
      expect(response.status).toBe(400);
    });

    it("should handle Redis save errors", async () => {
      mockedRedis.get.mockResolvedValue(JSON.stringify(mockChallenge));
      mockedRedis.setEx.mockRejectedValue(new Error("Redis save failed"));

      const response = await PUT(
        mockRequest({ session: { wpm: 75, accuracy: 95, textLength: 100, timeSpent: 120 } }),
        mockParams
      );
      
      expect(response.status).toBe(500);
    });

    it("should preserve best scores in speedCombo challenges", async () => {
      const speedComboWithData = {
        ...mockChallenge,
        type: "speedCombo",
        target: { wpm: 70, accuracy: 90 },
        data: {
          bestWpm: 80,
          bestAccuracy: 95,
          attempts: 2
        }
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(speedComboWithData));
      mockedRedis.setEx.mockResolvedValue("OK");

      const sessionData = {
        wpm: 75, // Lower than existing best
        accuracy: 92, // Lower than existing best
        textLength: 200,
        timeSpent: 180
      };

      const response = await PUT(
        mockRequest({ session: sessionData }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.bestWpm).toBe(80); // Should preserve higher value
      expect(data.data.bestAccuracy).toBe(95); // Should preserve higher value
      expect(data.data.attempts).toBe(3); // Should increment
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle malformed JSON in Redis", async () => {
      mockedRedis.get.mockResolvedValue("invalid json");

      const response = await GET(mockRequest(), mockParams);
      
      expect(response.status).toBe(500);
    });

    it("should handle Redis connection timeout", async () => {
      mockedRedis.get.mockRejectedValue(new Error("ETIMEDOUT"));

      const response = await GET(mockRequest(), mockParams);
      
      expect(response.status).toBe(500);
    });

    it("should validate numeric session data bounds", async () => {
      mockedRedis.get.mockResolvedValue(JSON.stringify(mockChallenge));

      const invalidSession = {
        wpm: -50, // Invalid negative
        accuracy: 150, // Invalid > 100
        textLength: -100, // Invalid negative
        timeSpent: -60 // Invalid negative
      };

      const response = await PUT(
        mockRequest({ session: invalidSession }),
        mockParams
      );
      
      expect(response.status).toBe(400);
    });
  });
});