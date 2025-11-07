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
} as unknown as DailyChallenge);

/**
 * Creates mock session data for testing
 */
export const createMockSession = (overrides: Partial<SessionData> = {}): SessionData => ({
  wpm: 75,
  accuracy: 96,
  textLength: 200,
  timeSpent: 180,
  errors: 0,
  // Ensure required numeric fields are always present (avoid undefined)
  dailyAvgWpm: 75,
  dailyAvgAcc: 96,
  sessionsCount: 1,
  ...overrides,
});

/**
 * Creates a mock NextRequest for testing API endpoints
 */
export const createMockRequest = (
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    url?: string;
  } = {}
) => {
  const { method = "GET", headers = {}, body, url = "http://localhost:3000/api/test" } = options;

  type MinimalNextRequest = {
    method: string;
    url: string;
    headers: Headers;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  };

  const req: MinimalNextRequest = {
    method,
    url,
    headers: new Headers({
      "x-user-id": "test-user-123",
      "content-type": "application/json",
      ...headers,
    }),
    json: () => Promise.resolve(body ?? {}),
    text: () => Promise.resolve(JSON.stringify(body ?? {})),
  };

  return req;
};

/**
 * Mock NextResponse for testing
 */
export class MockNextResponse {
  constructor(
    public body: unknown,
    public init: { status?: number; headers?: Record<string, string> } = {}
  ) {}

  static json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    return new MockNextResponse(data, init);
  }

  get status() {
    return this.init.status || 200;
  }

  async json(): Promise<unknown> {
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
  jest.spyOn(global, 'Date').mockImplementation(() => mockDate as unknown as Date);
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
export const simulateRedisError = (mockRedis: ReturnType<typeof createRedisMock>, errorType: string = "connection") => {
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
  isValidChallenge: (challenge: unknown): challenge is DailyChallenge => {
    if (typeof challenge !== 'object' || challenge === null) return false;
    const c = challenge as Record<string, unknown>;
    return (
      typeof c.id === 'string' &&
      typeof c.date === 'string' &&
      typeof c.type === 'string' &&
      typeof c.status === 'number' &&
      typeof c.xp === 'number'
    );
  },

  isValidSession: (session: unknown): session is SessionData => {
    if (typeof session !== 'object' || session === null) return false;
    const s = session as Record<string, unknown>;
    if (typeof s.wpm !== 'number' || typeof s.accuracy !== 'number') return false;
    return s.wpm >= 0 && s.accuracy >= 0 && s.accuracy <= 100;
  },

  isValidApiResponse: (response: unknown) => {
    return response !== null && typeof response === 'object' && !Array.isArray(response);
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
  (process as unknown as { env: Record<string, string | undefined> }).env.NODE_ENV = "test";
  (process as unknown as { env: Record<string, string | undefined> }).env.REDIS_PARALLEL = "false";

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

// --- Additional helper exports expected by tests (minimal implementations) ---

export const generateId = (prefix = "id") => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export const validateEmail = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

export const sanitizeInput = (s: string) => String(s).trim();

export const formatDate = (d?: Date | string) => new Date(d || Date.now()).toISOString();

export const calculateWpm = (chars: number, seconds: number) => Math.round((chars / 5) / (seconds / 60));

export const calculateAccuracy = (correct: number, total: number) => Math.round((correct / Math.max(1, total)) * 100);

export const hashPassword = async (s: string) => `hashed_${s}`;
export const verifyPassword = async (s: string, hash: string) => hash === `hashed_${s}`;

export const generateSecureToken = (len = 32) => Math.random().toString(36).slice(2, 2 + len);

export const rateLimitKey = (...parts: string[]) => parts.join(":");

export const isValidUrl = (u: string) => {
  try { new URL(u); return true; } catch { return false; }
};

export const truncateText = (s: string, max = 200) => (s.length > max ? s.slice(0, max) + '...' : s);

export const normalizeString = (s: string) => s.normalize('NFKC').trim();

export function debounce<F extends (...args: unknown[]) => unknown>(fn: F, wait = 50) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<F>): void => {
    if (t) clearTimeout(t);
    const call = fn as (...a: Parameters<F>) => ReturnType<F>;
    t = setTimeout(() => { void call(...args); }, wait);
  };
}

export function throttle<F extends (...args: unknown[]) => unknown>(fn: F, wait = 50) {
  let last = 0;
  return (...args: Parameters<F>): unknown | void => {
    const now = Date.now();
    if (now - last > wait) {
      last = now;
      const call = fn as (...a: Parameters<F>) => ReturnType<F>;
      return call(...args);
    }
  };
}

export const retryWithBackoff = async <T>(fn: () => Promise<T>, retries = 3, baseMs = 100): Promise<T> => {
  let attempt = 0;
  while (true) {
    try { return await fn(); } catch (err) {
      if (++attempt > retries) throw err;
      await new Promise(r => setTimeout(r, baseMs * attempt));
    }
  }
};

// Provide a lightweight mock prisma object used by tests
export const mockPrisma = createDatabaseMock();

export const resetAllMocks = () => {
  jest.clearAllMocks();
  jest.resetAllMocks();
};