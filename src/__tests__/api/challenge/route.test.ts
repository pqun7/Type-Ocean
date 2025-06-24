// __tests__/routes.test.ts

import { GET, POST, DELETE } from "@/app/api/challenge/v1/daily/route";

import { NextRequest } from "next/server";
import redis from "@/lib/redis";
import { generateDailyChallenge } from "@/features/level/utils/challengeHelpers";
import { getUserLevel } from "@/features/level/server-utils/userCache";

import { getTodayDate } from "@/features/auth/utils/timeUtils";

jest.mock("next/server", () => {
  return {
    NextRequest: class {
      constructor(public request: any) {
        Object.assign(this, request);
      }
      json() {
        return Promise.resolve(this.request.body);
      }
      headers = new Map(Object.entries(this.request.headers || {}));
    },
    NextResponse: class {
      body: any;
      status: number;
      headers: Record<string, string>;

      constructor(body: any, options: any = {}) {
        this.body = body;
        this.status = options.status || 200;
        this.headers = options.headers || {};
      }

      static json(data: any, options: any = {}) {
        return new this(data, { status: options.status });
      }

      async json() {
        return this.body;
      }
    },
  };
});

// Mock external dependencies
jest.mock("@/lib/redis");
jest.mock("@/features/level/utils/challengeHelpers", () => ({
  ...jest.requireActual("@/features/level/utils/challengeHelpers"),
  validateChallenge: jest.fn().mockReturnValue(true),
  generateDailyChallenge: jest.fn(),
  getChallengeXP: jest.fn().mockReturnValue(100),
  getChallengeTypeWeights: jest.fn().mockReturnValue({
    speedCombo: 1,
    marathon: 1,
    accuracy: 1,
    endurance: 1,
  }),
}));
// في ملف timeUtils.ts
jest.mock("@/features/auth/utils/timeUtils", () => ({
  getTodayDate: jest.fn(() => "2024-01-01"),
  getLocalMidnightTTL: jest.fn(() => 86400),
}));
jest.mock("@/features/level/server-utils/userCache");

const mockedRedis = redis as jest.Mocked<typeof redis>;
const mockedGenerateDailyChallenge = generateDailyChallenge as jest.Mock;
const mockedGetUserLevel = getUserLevel as jest.Mock;
const mockedGetTodayDate = getTodayDate as jest.Mock;

// Mock UUID and environment variables
jest.mock("uuid", () => ({
  v4: () => "mock-request-id",
}));

beforeEach(() => {
  jest.clearAllMocks();
  (process.env as any).NODE_ENV = "test";
  process.env.REDIS_PARALLEL = "false";
  mockedGetTodayDate.mockReturnValue("2024-01-01");
});

describe("GET /api/challenge/v1", () => {
  const mockRequest = (headers = {}) =>
    ({
      headers: new Headers({
        "x-user-id": "user-123",
        ...headers,
      }),
    }) as NextRequest;

  it("should return 401 when unauthorized", async () => {
    const response = await GET(mockRequest({ "x-user-id": undefined }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  // في ملف الاختبار __tests__/api/challenge/route.test.ts

  // تحديث mock لـ Redis connection
  jest.mock("@/lib/redis", () => ({
    __esModule: true,
    default: {
      get: jest.fn(),
      setEx: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      multi: () => ({
        setEx: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([true]),
      }),
      connectIfNeeded: jest.fn().mockResolvedValue(true),
    },
  }));

  // تحديث اختبار ال cache
  it("should return cached challenge when available", async () => {
    const mockChallenge = {
      id: "challenge-1",
      date: "2024-01-01",
      type: "marathon",
      data: { charactersTyped: 0 },
      status: 0,
      xp: 100,
    };

    mockedRedis.get.mockResolvedValue(JSON.stringify(mockChallenge));

    const response = await GET(mockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockChallenge);
  });

  // تحديث اختبار cache miss
  it("should generate new challenge when cache miss", async () => {
    const mockChallenge = {
      id: "challenge-2",
      date: "2024-01-01",
      type: "timeAttack",
      data: { timeSpent: 0 },
      status: 0,
      xp: 150,
    };

    mockedRedis.get.mockResolvedValue(null);
    mockedGenerateDailyChallenge.mockResolvedValue(mockChallenge);
    mockedGetUserLevel.mockResolvedValue(5);

    const response = await GET(mockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockChallenge);
  });

  it("should generate new challenge when cache miss", async () => {
    const mockChallenge = {
      id: "challenge-2",
      date: "2024-01-01",
      type: "timeAttack",
      data: { timeSpent: 0 },
      status: 0,
      xp: 150,
    };

    mockedRedis.get.mockResolvedValue(null);
    mockedGenerateDailyChallenge.mockResolvedValue(mockChallenge);
    mockedGetUserLevel.mockResolvedValue(5);

    const response = await GET(mockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockChallenge);
  });

  it("should handle parallel operations when enabled", async () => {
    process.env.REDIS_PARALLEL = "true";
    const mockChallenge = { id: "challenge-3", date: "2024-01-01" };
    mockedRedis.get.mockResolvedValue(null);
    mockedGenerateDailyChallenge.mockResolvedValue(mockChallenge);
    mockedGetUserLevel.mockResolvedValue(7);

    const response = await GET(mockRequest());

    expect(mockedGetUserLevel).toBeCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it("should handle Redis errors gracefully", async () => {
    mockedRedis.get.mockRejectedValue(new Error("Redis connection failed"));

    const response = await GET(mockRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain("Failed to fetch challenge");
  });
});

describe("POST /api/challenge/v1", () => {
  const mockRequest = (body: any, headers = {}) =>
    ({
      headers: new Headers({
        "x-user-id": "user-123",
        ...headers,
      }),
      json: () => Promise.resolve(body),
    }) as NextRequest;

  it("should return 401 when unauthorized", async () => {
    const response = await POST(mockRequest({}, { "x-user-id": undefined }));
    expect(response.status).toBe(401);
  });

  // __tests__/routes.test.ts
  // تحديث اختبار التقدم
  it("should update challenge progress", async () => {
    const existingChallenge = {
      id: "challenge-1",
      date: "2024-01-01",
      type: "marathon",
      data: { charactersTyped: 0 },
      status: 0,
      xp: 100,
    };

    mockedRedis.get.mockResolvedValue(JSON.stringify(existingChallenge));

    const response = await POST(
      mockRequest(
        { progress: { charactersTyped: 75 } }, // إرسال بيانات التقدم الصحيحة
        { "x-user-id": "user-123" }
      )
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.charactersTyped).toBe(75);
    expect(data.status).toBe(-1); // التأكد من تحديث الحالة (in progress)
  });

  it("should return 404 when challenge not found", async () => {
    mockedRedis.get.mockResolvedValue(null);

    const response = await POST(
      mockRequest({ progress: { charactersTyped: 50 } }) 
    );
    expect(response.status).toBe(404);
  });

  it("should return 400 for expired challenge", async () => {
    const expiredChallenge = { id: "challenge-2", date: "2023-12-31" };
    mockedRedis.get.mockResolvedValue(JSON.stringify(expiredChallenge));

    const response = await POST(mockRequest({ progress: 50 }));
    expect(response.status).toBe(400);
  });

  it("should handle update errors", async () => {
    mockedRedis.get.mockRejectedValue(new Error("Update failed"));

    const response = await POST(mockRequest({ progress: 50 }));
    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/challenge/v1", () => {
  const mockRequest = (headers = {}) =>
    ({
      headers: new Headers({
        "x-user-id": "user-123",
        ...headers,
      }),
    }) as NextRequest;

  it("should return 401 when unauthorized", async () => {
    const response = await DELETE(mockRequest({ "x-user-id": undefined }));
    expect(response.status).toBe(401);
  });

  // __tests__/routes.test.ts
  it("should delete existing challenge", async () => {
    mockedRedis.exists.mockResolvedValue(1);
    mockedRedis.del.mockResolvedValue(1);

    const response = await DELETE(mockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe("Challenge deleted");
  });

  it("should handle deletion errors", async () => {
    mockedRedis.exists.mockResolvedValue(1);
    mockedRedis.del.mockRejectedValue(new Error("Deletion failed"));

    const response = await DELETE(mockRequest());
    expect(response.status).toBe(500);
  });

  it("should handle missing challenge", async () => {
    mockedRedis.del.mockResolvedValue(0);

    const response = await DELETE(mockRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "No challenge found" });
  });

  it("should handle deletion errors", async () => {
    mockedRedis.del.mockRejectedValue(new Error("Deletion failed"));

    const response = await DELETE(mockRequest());
    expect(response.status).toBe(500);
  });
});
