/**
 * Test utilities and helper functions for the Typing Fast App test suite
 * Provides mocks, fixtures, and testing utilities for consistent test environment
 */

import { DailyChallenge } from "@/features/level/types/level";
import { SessionData } from "@/features/level/types/level";

// ===== Test Fixtures =====

/**
 * Creates a mock daily challenge with customizable properties
 */
export const createMockChallenge = (overrides: Partial<DailyChallenge> = {}): DailyChallenge => ({
  id: "test-challenge-123",
  date: "2024-01-01",
  type: "speedCombo",
  target: { wpm: 70, accuracy: 95 },
  status: 0,
  xp: 150,
  difficulty: 3,
  data: {},
  ...overrides,
});

/**
 * Creates mock session data for testing
 */
export const createMockSession = (overrides: Partial<SessionData> = {}): SessionData => ({
  wpm: 75,
  accuracy: 96,
  textLength: 200,
  timeSpent: 180,
  ...overrides,
});

/**
 * Creates a mock NextRequest for testing API endpoints
 */
export const createMockRequest = (
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    url?: string;
  } = {}
) => {
  const { method = "GET", headers = {}, body, url = "http://localhost:3000/api/test" } = options;

  return {
    method,
    url,
    headers: new Headers({
      "x-user-id": "test-user-123",
      "content-type": "application/json",
      ...headers,
    }),
    json: () => Promise.resolve(body || {}),
    text: () => Promise.resolve(JSON.stringify(body || {})),
  } as any;
};

/**
 * Mock NextResponse for testing
 */
export class MockNextResponse {
  constructor(
    public body: any,
    public init: { status?: number; headers?: Record<string, string> } = {}
  ) {}

  static json(data: any, init: { status?: number; headers?: Record<string, string> } = {}) {
    return new MockNextResponse(data, init);
  }

  get status() {
    return this.init.status || 200;
  }

  async json() {
    return this.body;
  }

  get headers() {
    return new Headers(this.init.headers || {});
  }
}

// ===== Redis Mock Utilities =====

/**
 * Creates a comprehensive Redis mock with all required methods
 */
export const createRedisMock = () => ({
  get: jest.fn(),
  set: jest.fn(),
  setEx: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  hGet: jest.fn(),
  hSet: jest.fn(),
  hGetAll: jest.fn(),
  hDel: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  incr: jest.fn(),
  decr: jest.fn(),
  multi: jest.fn(() => ({
    setEx: jest.fn().mockReturnThis(),
    hSet: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([true, true]),
  })),
  pipeline: jest.fn(() => ({
    setEx: jest.fn().mockReturnThis(),
    hSet: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([true, true]),
  })),
  connectIfNeeded: jest.fn().mockResolvedValue(true),
  flushdb: jest.fn(),
  ping: jest.fn().mockResolvedValue("PONG"),
});

// ===== Time Mock Utilities =====

/**
 * Mock system time for consistent testing
 */
export const mockSystemTime = (dateString: string = "2024-01-01T12:00:00.000Z") => {
  const mockDate = new Date(dateString);
  jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
  return mockDate;
};

/**
 * Restore original Date implementation
 */
export const restoreSystemTime = () => {
  jest.restoreAllMocks();
};

// ===== Challenge Type Test Data =====

export const challengeTestData = {
  marathon: createMockChallenge({
    type: "marathon",
    target: 1000,
    data: { charactersTyped: 250 },
  }),
  timeAttack: createMockChallenge({
    type: "timeAttack",
    target: 600,
    data: { timeSpent: 300 },
  }),
  speedCombo: createMockChallenge({
    type: "speedCombo",
    target: { wpm: 80, accuracy: 95 },
    data: { bestWpm: 75, bestAccuracy: 92, attempts: 2 },
  }),
  accuracy: createMockChallenge({
    type: "accuracy",
    target: 98,
    data: { bestAccuracy: 95, attempts: 3 },
  }),
};

// ===== Session Test Data =====

export const sessionTestData = {
  excellent: createMockSession({ wpm: 90, accuracy: 98, textLength: 300, timeSpent: 200 }),
  good: createMockSession({ wpm: 75, accuracy: 95, textLength: 250, timeSpent: 200 }),
  average: createMockSession({ wpm: 60, accuracy: 90, textLength: 200, timeSpent: 200 }),
  poor: createMockSession({ wpm: 40, accuracy: 85, textLength: 150, timeSpent: 225 }),
  invalid: createMockSession({ wpm: -10, accuracy: 150, textLength: -50, timeSpent: -30 }),
};

// ===== Error Simulation Utilities =====

/**
 * Simulates Redis connection errors
 */
export const simulateRedisError = (mockRedis: any, errorType: string = "connection") => {
  const error = new Error(`Redis ${errorType} failed`);

  switch (errorType) {
    case "connection":
      mockRedis.connectIfNeeded.mockRejectedValue(error);
      break;
    case "timeout":
      mockRedis.get.mockRejectedValue(new Error("ETIMEDOUT"));
      break;
    case "save":
      mockRedis.setEx.mockRejectedValue(error);
      break;
    default:
      mockRedis.get.mockRejectedValue(error);
  }
};

/**
 * Simulates network timeout errors
 */
export const simulateNetworkTimeout = () => {
  return Promise.reject(new Error("Network timeout"));
};

// ===== Performance Testing Utilities =====

/**
 * Measures execution time of async functions
 */
export const measureExecutionTime = async <T>(fn: () => Promise<T>): Promise<{ result: T; timeMs: number }> => {
  const start = performance.now();
  const result = await fn();
  const timeMs = performance.now() - start;
  return { result, timeMs };
};

/**
 * Simulates concurrent requests for load testing
 */
export const simulateConcurrentRequests = async <T>(
  requestFn: () => Promise<T>,
  concurrency: number = 10,
  iterations: number = 100
): Promise<{ results: T[]; errors: Error[]; avgTimeMs: number }> => {
  const results: T[] = [];
  const errors: Error[] = [];
  const times: number[] = [];

  const executeRequest = async (): Promise<void> => {
    try {
      const { result, timeMs } = await measureExecutionTime(requestFn);
      results.push(result);
      times.push(timeMs);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  };

  // Execute requests in batches
  for (let i = 0; i < iterations; i += concurrency) {
    const batch = Array(Math.min(concurrency, iterations - i))
      .fill(null)
      .map(() => executeRequest());

    await Promise.allSettled(batch);
  }

  const avgTimeMs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;

  return { results, errors, avgTimeMs };
};

// ===== Memory Testing Utilities =====

/**
 * Monitors memory usage during test execution
 */
export const monitorMemoryUsage = () => {
  const initialMemory = process.memoryUsage();

  return {
    getMemoryDelta: () => {
      const currentMemory = process.memoryUsage();
      return {
        heapUsed: currentMemory.heapUsed - initialMemory.heapUsed,
        heapTotal: currentMemory.heapTotal - initialMemory.heapTotal,
        rss: currentMemory.rss - initialMemory.rss,
        external: currentMemory.external - initialMemory.external,
      };
    },
    initial: initialMemory,
  };
};

// ===== Database Test Utilities =====

/**
 * Creates test database connection mock
 */
export const createDatabaseMock = () => ({
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  session: {
    findMany: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  challenge: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
  $disconnect: jest.fn(),
  $connect: jest.fn(),
});

// ===== Validation Test Utilities =====

/**
 * Test data validation helpers
 */
export const validationHelpers = {
  isValidChallenge: (challenge: any): challenge is DailyChallenge => {
    return (
      typeof challenge === 'object' &&
      typeof challenge.id === 'string' &&
      typeof challenge.date === 'string' &&
      typeof challenge.type === 'string' &&
      typeof challenge.status === 'number' &&
      typeof challenge.xp === 'number'
    );
  },

  isValidSession: (session: any): session is SessionData => {
    return (
      typeof session === 'object' &&
      typeof session.wpm === 'number' &&
      typeof session.accuracy === 'number' &&
      session.wpm >= 0 &&
      session.accuracy >= 0 &&
      session.accuracy <= 100
    );
  },

  isValidApiResponse: (response: any) => {
    return response && typeof response === 'object' && !Array.isArray(response);
  },
};

// ===== Setup and Teardown Helpers =====

/**
 * Common test setup
 */
export const setupTest = () => {
  // Clear all mocks
  jest.clearAllMocks();

  // Mock environment variables
  process.env.NODE_ENV = "test";
  process.env.REDIS_PARALLEL = "false";

  // Mock console methods to reduce noise
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
};

/**
 * Common test teardown
 */
export const teardownTest = () => {
  jest.restoreAllMocks();
  jest.clearAllTimers();
  restoreSystemTime();
};

// ===== Export default test configuration =====

export const testConfig = {
  timeout: 10000,
  maxConcurrency: 50,
  defaultUserId: "test-user-123",
  defaultChallengeId: "test-challenge-123",
  testDate: "2024-01-01",
};