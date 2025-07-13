import { jest } from '@jest/globals';

/**
 * Enhanced test utilities for production-ready testing
 */

// Mock factory for creating realistic user sessions
export const createMockSession = (overrides: Partial<any> = {}) => ({
  wpm: 65,
  accuracy: 95,
  textLength: 200,
  timeSpent: 120,
  errors: 2,
  dailyAvgWpm: 62,
  dailyAvgAcc: 93,
  sessionsCount: 5,
  ...overrides
});

// Mock factory for creating daily challenges
export const createMockChallenge = (type: 'speedCombo' | 'marathon' | 'timeAttack' = 'speedCombo', overrides: Partial<any> = {}) => {
  const baseChallenge = {
    id: `test-${type}-${Date.now()}`,
    date: new Date().toISOString().split('T')[0],
    status: 0,
    xp: 150,
    difficulty: 3,
    ...overrides
  };

  switch (type) {
    case 'speedCombo':
      return {
        ...baseChallenge,
        type: 'speedCombo',
        target: { wpm: 60, accuracy: 95 },
        data: {}
      };
    case 'marathon':
      return {
        ...baseChallenge,
        type: 'marathon',
        target: 1000,
        data: { charactersTyped: 0 }
      };
    case 'timeAttack':
      return {
        ...baseChallenge,
        type: 'timeAttack',
        target: 1800,
        data: { timeSpent: 0 }
      };
  }
};

// Performance testing utilities
export const measureExecutionTime = async <T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> => {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
};

// Concurrent request simulation
export const simulateConcurrentRequests = async <T>(
  requestFn: () => Promise<T>,
  concurrency: number = 10
): Promise<T[]> => {
  const requests = Array.from({ length: concurrency }, () => requestFn());
  return Promise.all(requests);
};

// Mock Redis responses for different scenarios
export const createRedisMocks = () => ({
  cacheHit: (data: any) => jest.fn().mockResolvedValue(JSON.stringify(data)),
  cacheMiss: () => jest.fn().mockResolvedValue(null),
  connectionError: () => jest.fn().mockRejectedValue(new Error('Redis connection failed')),
  slowResponse: (data: any, delay: number = 1000) => 
    jest.fn().mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve(JSON.stringify(data)), delay))
    )
});

// API response validation helpers
export const validateApiResponse = (response: any, expectedStatus: number) => {
  expect(response.status).toBe(expectedStatus);
  expect(response.headers).toBeDefined();
  return response;
};

// Data integrity checkers
export const validateChallengeIntegrity = (challenge: any) => {
  expect(challenge.id).toBeDefined();
  expect(challenge.type).toMatch(/^(speedCombo|marathon|timeAttack)$/);
  expect(challenge.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(challenge.status).toMatch(/^[0-1]$/);
  expect(typeof challenge.xp).toBe('number');
  expect(challenge.xp).toBeGreaterThan(0);
};

// Error simulation utilities
export const createErrorScenarios = () => ({
  networkTimeout: () => new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Network timeout')), 5000)
  ),
  malformedData: () => Promise.resolve('invalid-json{'),
  unauthorizedAccess: () => ({ status: 401, message: 'Unauthorized' }),
  rateLimitExceeded: () => ({ status: 429, message: 'Too many requests' })
});

// Production environment simulation
export const setupProductionEnvironment = () => {
  process.env.NODE_ENV = 'production';
  process.env.REDIS_PARALLEL = 'true';
  process.env.API_INTERNAL_SECRET = 'test-secret';
};

// Cleanup utilities
export const cleanupTestEnvironment = () => {
  jest.clearAllMocks();
  jest.resetModules();
};

// Cache key generators for testing
export const getCacheKeys = (userId: string, date?: string) => ({
  dailyChallenge: `dailyChallenge:${userId}:${date || new Date().toISOString().split('T')[0]}`,
  sessionStats: `sessionStats:${userId}:${date || new Date().toISOString().split('T')[0]}`,
  userLevel: `userLevel:${userId}`
});

// Mock authentication headers
export const createAuthHeaders = (userId: string = 'test-user-123') => ({
  'x-user-id': userId,
  'authorization': `Bearer ${process.env.API_INTERNAL_SECRET || 'test-secret'}`,
  'content-type': 'application/json'
});

// Performance benchmarks
export const PERFORMANCE_THRESHOLDS = {
  CACHE_HIT: 50, // ms
  CACHE_MISS: 200, // ms
  CHALLENGE_GENERATION: 100, // ms
  CONCURRENT_REQUESTS: 500 // ms
} as const;

// Test data generators
export const generateTestData = {
  userIds: (count: number) => Array.from({ length: count }, (_, i) => `user-${i + 1}`),
  sessionBatch: (count: number) => Array.from({ length: count }, (_, i) => 
    createMockSession({ wpm: 50 + i * 2, accuracy: 90 + i })
  ),
  challengeBatch: (count: number) => Array.from({ length: count }, (_, i) => {
    const types = ['speedCombo', 'marathon', 'timeAttack'] as const;
    return createMockChallenge(types[i % 3]);
  })
};

export default {
  createMockSession,
  createMockChallenge,
  measureExecutionTime,
  simulateConcurrentRequests,
  createRedisMocks,
  validateApiResponse,
  validateChallengeIntegrity,
  createErrorScenarios,
  setupProductionEnvironment,
  cleanupTestEnvironment,
  getCacheKeys,
  createAuthHeaders,
  PERFORMANCE_THRESHOLDS,
  generateTestData
};