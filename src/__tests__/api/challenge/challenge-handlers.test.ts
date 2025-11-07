jest.mock('@/app/api/challenge/v1/shared', () => {
  return {
    authorizeRequest: jest.fn(() => 'test-user'),
    connectIfNeeded: jest.fn(),
    redis: {
      get: jest.fn(),
      setEx: jest.fn(),
      exists: jest.fn(),
      del: jest.fn(),
    },
    getCacheKey: jest.fn(() => 'cache:test-user'),
    getCacheTTL: jest.fn(() => 3600),
    logRequestStart: jest.fn(),
    logRequestSuccess: jest.fn(),
    logRequestError: jest.fn(),
    getTodayDate: jest.fn(() => '2025-10-24'),
  };
});

jest.mock('@/features/level/utils/challengeHelpers', () => ({
  calculateChallengeStatus: jest.fn(() => 1),
  generateDailyChallenge: jest.fn(async () => ({})),
}));

// Mock next/server to avoid runtime dependency on web Request in Jest environment
jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: any, opts?: any) => ({ body, opts }),
  },
}));

import { redis } from '@/app/api/challenge/v1/shared';
import { handleChallengeUpdate } from '@/app/api/challenge/v1/daily/route';

describe('handleChallengeUpdate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts POST with { progress } and saves updated challenge', async () => {
    // Arrange: existing cached challenge
    const existing = {
      id: 'c1',
      date: '2025-10-24',
      type: 'speedCombo',
      progress: {},
      status: 0,
    };

    (redis.get as jest.Mock).mockResolvedValue(JSON.stringify(existing));
    (redis.setEx as jest.Mock).mockResolvedValue(true);

    const req = { json: async () => ({ progress: { wpm: 80, accuracy: 98, completed: true } }) } as unknown as NextRequest;

    // Act
  await handleChallengeUpdate(req, 'POST');

    // Assert: saved to redis with updated status
    expect(redis.setEx).toHaveBeenCalled();
    const savedArg = (redis.setEx as jest.Mock).mock.calls[0][2];
    const saved = JSON.parse(savedArg);
    expect(saved.id).toBe('c1');
    expect(saved.status).toBe(1);
  });

  it('accepts POST with direct wpm/accuracy fields and saves', async () => {
    const existing = {
      id: 'c2',
      date: '2025-10-24',
      type: 'speedCombo',
      progress: {},
      status: 0,
    };

    (redis.get as jest.Mock).mockResolvedValue(JSON.stringify(existing));
    (redis.setEx as jest.Mock).mockResolvedValue(true);

    const req = { json: async () => ({ wpm: 70, accuracy: 95, completed: false }) } as unknown as NextRequest;

    await handleChallengeUpdate(req, 'POST');

    expect(redis.setEx).toHaveBeenCalled();
    const savedArg = (redis.setEx as jest.Mock).mock.calls[0][2];
    const saved = JSON.parse(savedArg);
    expect(saved.id).toBe('c2');
    expect(saved.status).toBe(1);
  });
});
