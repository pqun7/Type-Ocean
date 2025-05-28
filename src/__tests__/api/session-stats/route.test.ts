import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/session-stats/v1/route";
import redis from "@/lib/redis";
import { logging } from "@/log/ServerLogger";

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

jest.mock("@/log/ServerLogger", () => ({
  logging: {
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const mockRedis = redis as jest.Mocked<typeof redis>;

const mockRequest = (body: any, headers: Record<string, string>): NextRequest => {
  return {
    request: { body, headers },
    json: () => Promise.resolve(body),
    headers: new Map(Object.entries(headers)),
  } as unknown as NextRequest;
};

jest.mock("@/lib/redis", () => ({
  connectIfNeeded: jest.fn().mockResolvedValue(undefined),
  hSet: jest.fn().mockResolvedValue(1),
  exists: jest.fn(),
  hGetAll: jest.fn(),
  on: jest.fn(),
}));

jest.mock("@/features/auth/lib/rate-limiter", () => ({
  enforceRateLimit: jest.fn(),
}));

import { enforceRateLimit } from "@/lib/rate-limiter";
const mockEnforceRateLimit = enforceRateLimit as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockEnforceRateLimit.mockResolvedValue(null); // ✅ Ensure valid auth in tests unless explicitly overridden
});

afterEach(() => {
  jest.useRealTimers();
});


describe("POST /api/session-stats/v1", () => {
  it("should return 401 if no user ID", async () => {
    const req = mockRequest({}, {});
    const res = await POST(req as any);

    expect(res.status).toBe(401);
    expect(logging.warn).toBeCalledWith(
      "[STATS] Unauthorized stats update attempt"
    );
  });

  it("should return 400 for invalid data types", async () => {
    const req = mockRequest(
      { wpm: "invalid", accuracy: 90 },
      { "x-user-id": "user1" }
    );
    const res = await POST(req as any);

    expect(res.status).toBe(400);
    expect(logging.warn).toBeCalledWith(
      expect.stringContaining("Invalid input"),
      expect.any(Object)
    );
  });

  it("should create new entry for first session", async () => {
    const today = new Date().toISOString().split("T")[0];
    mockRedis.exists.mockResolvedValue(0);

    const req = mockRequest(
      { wpm: 60, accuracy: 95 },
      { "x-user-id": "user1" }
    );
    const res = await POST(req as any);

    expect(mockRedis.hSet).toBeCalledWith("sessionStats:user1", {
      n: 1,
      avgWpm: 60,
      avgAcc: 95,
      date: today,
    });
    expect(await res.json()).toEqual({
      dailyAvgWpm: 60,
      dailyAvgAcc: 95,
      sessionsCount: 1,
    });
  });

  it("should update existing entry for same day", async () => {
    const today = new Date().toISOString().split("T")[0];
    mockRedis.exists.mockResolvedValue(1);
    mockRedis.hGetAll.mockResolvedValue({
      n: "3",
      avgWpm: "50",
      avgAcc: "90",
      date: today,
    });

    const req = mockRequest(
      { wpm: 60, accuracy: 95 },
      { "x-user-id": "user1" }
    );
    const res = await POST(req as any);

    const expectedWpm = (50 * 3 + 60) / 4;
    const expectedAcc = (90 * 3 + 95) / 4;

    expect(mockRedis.hSet).toBeCalledWith(
      "sessionStats:user1",
      expect.objectContaining({
        n: 4,
        avgWpm: expectedWpm.toFixed(2),
        avgAcc: expectedAcc.toFixed(2),
      })
    );
    expect(await res.json()).toEqual({
      dailyAvgWpm: expectedWpm,
      dailyAvgAcc: expectedAcc,
      sessionsCount: 4,
    });
  });

  it("should handle Redis errors", async () => {
    mockRedis.exists.mockRejectedValue(new Error("DB error"));

    const req = mockRequest(
      { wpm: 60, accuracy: 95 },
      { "x-user-id": "user1" }
    );
    const res = await POST(req as any);

    expect(res.status).toBe(500);
    expect(logging.error).toBeCalledWith(
      expect.stringContaining("Processing error"),
      expect.any(Error),
      expect.any(Object)
    );
  });

  it("should return 400 for negative wpm or accuracy", async () => {
    const req1 = mockRequest(
      { wpm: -10, accuracy: 95 },
      { "x-user-id": "user1" }
    );
    const res1 = await POST(req1 as any);
    expect(res1.status).toBe(400);
    expect(logging.warn).toBeCalledWith(
      expect.stringContaining("Invalid input"),
      expect.any(Object)
    );

    const req2 = mockRequest(
      { wpm: 60, accuracy: -5 },
      { "x-user-id": "user1" }
    );
    const res2 = await POST(req2 as any);
    expect(res2.status).toBe(400);
    expect(logging.warn).toBeCalledWith(
      expect.stringContaining("Invalid input"),
      expect.any(Object)
    );
  });

  it("should handle Redis hSet error during update", async () => {
    mockRedis.exists.mockResolvedValue(1);
    mockRedis.hGetAll.mockResolvedValue({
      n: "3",
      avgWpm: "50",
      avgAcc: "90",
      date: new Date().toISOString().split("T")[0],
    });
    mockRedis.hSet.mockRejectedValue(new Error("hSet failed"));

    const req = mockRequest(
      { wpm: 60, accuracy: 95 },
      { "x-user-id": "user1" }
    );
    const res = await POST(req as any);

    expect(res.status).toBe(500);
    expect(logging.error).toBeCalledWith(
      expect.stringContaining("Processing error"),
      expect.any(Error),
      expect.any(Object)
    );
  });

  it("should reset stats when existing data is corrupted", async () => {
    const today = new Date().toISOString().split("T")[0];
    mockRedis.exists.mockResolvedValue(1);
    mockRedis.hGetAll.mockResolvedValue({
      date: today,
      avgAcc: "invalid", // بيانات تالفة
    });

    const req = mockRequest(
      { wpm: 60, accuracy: 95 },
      { "x-user-id": "user1" }
    );
    const res = await POST(req as any);

    expect(mockRedis.hSet).toBeCalledWith("sessionStats:user1", {
      n: 1,
      avgWpm: 60,
      avgAcc: 95,
      date: today,
    });
    expect(await res.json()).toEqual({
      dailyAvgWpm: 60,
      dailyAvgAcc: 95,
      sessionsCount: 1,
    });
  });
});

describe("Rate Limiting", () => {
  it("should return 429 when rate limit is exceeded", async () => {
    // 🚨 Simulate rate limit response
    mockEnforceRateLimit.mockResolvedValue(
      new NextResponse(null, { status: 429 })
    );

    const req = mockRequest({}, { "x-user-id": "user1" });
    const res = await POST(req as any);

    expect(res.status).toBe(429);
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "/api/session-stats/v1"
    );
  });

  it("should proceed with valid request when under limit", async () => {
    // ✅ Simulate successful rate limit check
    mockEnforceRateLimit.mockResolvedValue({
      "x-ratelimit-remaining": "10",
    });

    mockRedis.exists.mockResolvedValue(0);
    const today = new Date().toISOString().split("T")[0];

    const req = mockRequest(
      { wpm: 60, accuracy: 95 },
      { "x-user-id": "user1" }
    );

    const res = await POST(req as any);

    expect(res.status).toBe(200);
    expect(mockRedis.hSet).toHaveBeenCalledWith(
      "sessionStats:user1",
      expect.objectContaining({
        n: 1,
        avgWpm: 60,
        avgAcc: 95,
      })
    );
  });

  it("should not process data when rate limited", async () => {
    // 🚨 Simulate rate limit response
    mockEnforceRateLimit.mockResolvedValue(
      new NextResponse(null, { status: 429 })
    );

    const req = mockRequest(
      { wpm: 60, accuracy: 95 },
      { "x-user-id": "user1" }
    );

    const res = await POST(req as any);

    expect(res.status).toBe(429);
    expect(mockRedis.hSet).not.toHaveBeenCalled();
  });
});
