/**
 * Redis Mock for Testing
 * Provides comprehensive mocking of Redis operations for tests
 */

// Mock data structures
export const mockChallengeData = {
  basic: {
    id: 'challenge-2024-01-01-basic',
    type: 'speedCombo' as const,
    title: 'Speed & Accuracy Challenge',
    description: 'Achieve 60 WPM with 90% accuracy',
    text: 'The quick brown fox jumps over the lazy dog. This pangram contains every letter of the alphabet at least once.',
    target: { wpm: 60, accuracy: 90 },
    difficulty: 'medium' as const,
    date: '2024-01-01',
    status: 0, // In progress
    progress: { attempts: 0, bestWpm: 0, bestAccuracy: 0 },
    reward: { xp: 100, title: 'Speed Demon' },
    timeLimit: 300 // 5 minutes
  },
  speedCombo: {
    id: 'challenge-2024-01-01-speed',
    type: 'speedCombo' as const,
    title: 'Advanced Speed Challenge',
    description: 'Reach 80 WPM with 95% accuracy',
    text: 'Advanced typing requires consistent practice and focus. The ability to type quickly while maintaining high accuracy is a valuable skill.',
    target: { wpm: 80, accuracy: 95 },
    difficulty: 'hard' as const,
    date: '2024-01-01',
    status: 0,
    progress: { attempts: 1, bestWpm: 75, bestAccuracy: 92 },
    reward: { xp: 200, title: 'Typing Master' },
    timeLimit: 600
  },
  marathon: {
    id: 'challenge-2024-01-01-marathon',
    type: 'marathon' as const,
    title: 'Endurance Marathon',
    description: 'Type 500 words with consistent performance',
    text: 'This is a long text for marathon challenge that requires sustained focus and endurance...',
    target: { textLength: 500, consistency: 85 },
    difficulty: 'expert' as const,
    date: '2024-01-01',
    status: 0,
    progress: { wordsTyped: 150, consistency: 80 },
    reward: { xp: 300, title: 'Marathon Runner' },
    timeLimit: 1800 // 30 minutes
  },
  perfectionist: {
    id: 'challenge-2024-01-01-perfect',
    type: 'perfectionist' as const,
    title: 'Perfectionist Challenge',
    description: 'Achieve 100% accuracy with minimum 40 WPM',
    text: 'Perfection in typing means zero errors while maintaining reasonable speed.',
    target: { accuracy: 100, minWpm: 40 },
    difficulty: 'hard' as const,
    date: '2024-01-01',
    status: 0,
    progress: { attempts: 3, bestAccuracy: 98 },
    reward: { xp: 250, title: 'Perfectionist' },
    timeLimit: 900
  }
};

export const mockSessionData = {
  basic: {
    wpm: 65,
    accuracy: 92,
    textLength: 100,
    timeSpent: 120,
    errors: 8,
    correctChars: 500,
    totalChars: 508
  },
  advanced: {
    wpm: 85,
    accuracy: 96,
    textLength: 150,
    timeSpent: 180,
    errors: 6,
    correctChars: 750,
    totalChars: 756
  },
  perfect: {
    wpm: 45,
    accuracy: 100,
    textLength: 80,
    timeSpent: 120,
    errors: 0,
    correctChars: 400,
    totalChars: 400
  }
};

export const mockUserLevelData = {
  beginner: { level: 1, xp: 50, totalXp: 50 },
  intermediate: { level: 5, xp: 250, totalXp: 1250 },
  advanced: { level: 10, xp: 500, totalXp: 5500 },
  expert: { level: 20, xp: 1000, totalXp: 15000 }
};

// Mock Redis client
const redisMock = {
  // Basic operations
  get: jest.fn(),
  set: jest.fn(),
  setEx: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  
  // Hash operations
  hGet: jest.fn(),
  hSet: jest.fn(),
  hGetAll: jest.fn(),
  hDel: jest.fn(),
  hExists: jest.fn(),
  
  // List operations
  lPush: jest.fn(),
  rPush: jest.fn(),
  lPop: jest.fn(),
  rPop: jest.fn(),
  lRange: jest.fn(),
  lLen: jest.fn(),
  
  // Set operations
  sAdd: jest.fn(),
  sRem: jest.fn(),
  sMembers: jest.fn(),
  sIsMember: jest.fn(),
  sCard: jest.fn(),
  
  // Sorted set operations
  zAdd: jest.fn(),
  zRange: jest.fn(),
  zRank: jest.fn(),
  zScore: jest.fn(),
  zCard: jest.fn(),
  
  // Connection
  ping: jest.fn(),
  quit: jest.fn(),
  disconnect: jest.fn(),
  
  // Pub/Sub
  publish: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  
  // Transactions
  multi: jest.fn(() => ({
    get: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setEx: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(['OK', 'OK'])
  })),
  
  // Lua scripts
  eval: jest.fn(),
  evalSha: jest.fn(),
  
  // Advanced operations
  scan: jest.fn(),
  keys: jest.fn(),
  flushDb: jest.fn(),
  flushAll: jest.fn(),
  
  // Rate limiting simulation
  incr: jest.fn(),
  incrBy: jest.fn(),
  decr: jest.fn(),
  decrBy: jest.fn()
};

// Default mock implementations
export const setupDefaultMocks = () => {
  // Basic successful operations
  redisMock.get.mockResolvedValue(null);
  redisMock.set.mockResolvedValue('OK');
  redisMock.setEx.mockResolvedValue('OK');
  redisMock.del.mockResolvedValue(1);
  redisMock.exists.mockResolvedValue(0);
  redisMock.expire.mockResolvedValue(1);
  redisMock.ttl.mockResolvedValue(-1);
  
  // Hash operations
  redisMock.hGet.mockResolvedValue(null);
  redisMock.hSet.mockResolvedValue(1);
  redisMock.hGetAll.mockResolvedValue({});
  redisMock.hDel.mockResolvedValue(1);
  redisMock.hExists.mockResolvedValue(0);
  
  // List operations
  redisMock.lPush.mockResolvedValue(1);
  redisMock.rPush.mockResolvedValue(1);
  redisMock.lPop.mockResolvedValue(null);
  redisMock.rPop.mockResolvedValue(null);
  redisMock.lRange.mockResolvedValue([]);
  redisMock.lLen.mockResolvedValue(0);
  
  // Set operations
  redisMock.sAdd.mockResolvedValue(1);
  redisMock.sRem.mockResolvedValue(1);
  redisMock.sMembers.mockResolvedValue([]);
  redisMock.sIsMember.mockResolvedValue(0);
  redisMock.sCard.mockResolvedValue(0);
  
  // Sorted set operations
  redisMock.zAdd.mockResolvedValue(1);
  redisMock.zRange.mockResolvedValue([]);
  redisMock.zRank.mockResolvedValue(null);
  redisMock.zScore.mockResolvedValue(null);
  redisMock.zCard.mockResolvedValue(0);
  
  // Connection
  redisMock.ping.mockResolvedValue('PONG');
  redisMock.quit.mockResolvedValue('OK');
  redisMock.disconnect.mockResolvedValue(undefined);
  
  // Pub/Sub
  redisMock.publish.mockResolvedValue(0);
  
  // Advanced operations
  redisMock.scan.mockResolvedValue(['0', []]);
  redisMock.keys.mockResolvedValue([]);
  redisMock.flushDb.mockResolvedValue('OK');
  redisMock.flushAll.mockResolvedValue('OK');
  
  // Rate limiting
  redisMock.incr.mockResolvedValue(1);
  redisMock.incrBy.mockResolvedValue(1);
  redisMock.decr.mockResolvedValue(0);
  redisMock.decrBy.mockResolvedValue(0);
};

// Helper functions for common test scenarios
export const mockChallengeCache = (challengeData: any, userId = 'test-user-123') => {
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `dailyChallenge:${userId}:${today}`;
  redisMock.get.mockImplementation((key: string) => {
    if (key === cacheKey) {
      return Promise.resolve(JSON.stringify(challengeData));
    }
    return Promise.resolve(null);
  });
};

export const mockUserLevelCache = (levelData: any, userId = 'test-user-123') => {
  const cacheKey = `userLevel:${userId}`;
  redisMock.hGetAll.mockImplementation((key: string) => {
    if (key === cacheKey) {
      return Promise.resolve(levelData);
    }
    return Promise.resolve({});
  });
};

export const mockSessionStatsCache = (sessionData: any, userId = 'test-user-123') => {
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `sessionStats:${userId}:${today}`;
  redisMock.lRange.mockImplementation((key: string) => {
    if (key === cacheKey) {
      return Promise.resolve([JSON.stringify(sessionData)]);
    }
    return Promise.resolve([]);
  });
};

export const mockRateLimitCache = (requests = 1, window = 60) => {
  redisMock.incr.mockResolvedValue(requests);
  redisMock.expire.mockResolvedValue(1);
  redisMock.ttl.mockResolvedValue(window);
};

export const simulateRedisError = (operation: keyof typeof redisMock, error = new Error('Redis connection failed')) => {
  (redisMock[operation] as jest.Mock).mockRejectedValue(error);
};

export const simulateRedisTimeout = (operation: keyof typeof redisMock, timeout = 1000) => {
  (redisMock[operation] as jest.Mock).mockImplementation(() =>
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Operation timeout')), timeout)
    )
  );
};

// Reset function for clean test state
export const resetRedisMock = () => {
  jest.clearAllMocks();
  setupDefaultMocks();
};

// Advanced simulation helpers
export const simulateHighLoad = () => {
  // Simulate slower responses under load
  const slowResponse = (value: any) => 
    new Promise(resolve => setTimeout(() => resolve(value), 100));
  
  redisMock.get.mockImplementation(() => slowResponse(null));
  redisMock.set.mockImplementation(() => slowResponse('OK'));
  redisMock.setEx.mockImplementation(() => slowResponse('OK'));
};

export const simulateMemoryPressure = () => {
  // Simulate memory pressure with occasional failures
  let callCount = 0;
  redisMock.setEx.mockImplementation(() => {
    callCount++;
    if (callCount % 5 === 0) {
      return Promise.reject(new Error('OOM: Redis out of memory'));
    }
    return Promise.resolve('OK');
  });
};

export const simulateNetworkPartition = () => {
  // Simulate network issues
  const networkError = new Error('ECONNREFUSED: Connection refused');
  Object.keys(redisMock).forEach(key => {
    if (typeof redisMock[key as keyof typeof redisMock] === 'function') {
      (redisMock[key as keyof typeof redisMock] as jest.Mock).mockRejectedValue(networkError);
    }
  });
};

// Test utilities for specific scenarios
export const createMockChallenge = (overrides: Partial<typeof mockChallengeData.basic> = {}) => {
  return {
    ...mockChallengeData.basic,
    ...overrides
  };
};

export const createMockSession = (overrides: Partial<typeof mockSessionData.basic> = {}) => {
  return {
    ...mockSessionData.basic,
    ...overrides
  };
};

// Setup default mocks on import
setupDefaultMocks();

export default redisMock;