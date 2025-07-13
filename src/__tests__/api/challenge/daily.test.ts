/**
 * Comprehensive tests for Daily Challenge API endpoints
 * Tests both /daily route and /daily/[challengeId] route
 */

import { NextRequest } from 'next/server';
import { GET, POST, PUT, DELETE } from '@/app/api/challenge/v1/daily/route';
import { GET as getChallengeById, PUT as putChallengeById } from '@/app/api/challenge/v1/daily/[challengeId]/route';
import redisMock, { resetRedisMock, mockChallengeData, mockSessionData } from '@/__tests__/helpers/redis.mock';

// Mock dependencies
jest.mock('@/lib/redis', () => require('@/__tests__/helpers/redis.mock').default);
jest.mock('@/features/level/server-utils/userCache', () => ({
  getUserLevel: jest.fn().mockResolvedValue({ level: 5, xp: 1250 }),
}));
jest.mock('@/features/level/utils/challengeHelpers', () => ({
  generateDailyChallenge: jest.fn().mockResolvedValue(mockChallengeData.basic),
  calculateChallengeStatus: jest.fn().mockReturnValue(1), // Completed
}));
jest.mock('@/log/loggingUtils', () => ({
  logRequestStart: jest.fn(),
  logRequestSuccess: jest.fn(),
  logRequestError: jest.fn(),
}));

// Helper function to create mock requests
const createMockRequest = (headers: Record<string, string> = {}, body?: any): NextRequest => {
  const url = 'http://localhost:3000/api/challenge/v1/daily';
  const defaultHeaders = {
    'x-user-id': 'test-user-123',
    'authorization': `Bearer ${process.env.API_INTERNAL_SECRET || 'test-secret'}`,
    ...headers,
  };

  const request = new NextRequest(url, {
    method: body ? 'POST' : 'GET',
    headers: defaultHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Mock the json() method for requests with body
  if (body) {
    (request as any).json = jest.fn().mockResolvedValue(body);
  }

  return request;
};

// Helper to create params for challengeId routes
const createMockParams = (challengeId: string) => Promise.resolve({ challengeId });

describe('Daily Challenge API', () => {
  beforeEach(() => {
    resetRedisMock();
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.API_INTERNAL_SECRET = 'test-secret';
  });

  describe('GET /daily - Fetch Daily Challenge', () => {
    it('should return cached challenge when available', async () => {
      // Setup: Mock cached challenge
      const cachedChallenge = JSON.stringify(mockChallengeData.basic);
      redisMock.get.mockResolvedValue(cachedChallenge);

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe(mockChallengeData.basic.id);
      expect(redisMock.get).toHaveBeenCalledWith('dailyChallenge:test-user-123:2024-01-01');
    });

    it('should generate new challenge when cache miss', async () => {
      // Setup: No cached challenge
      redisMock.get.mockResolvedValue(null);

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBeDefined();
      expect(redisMock.setEx).toHaveBeenCalled();
    });

    it('should return 401 for unauthorized requests', async () => {
      const request = createMockRequest({ 'x-user-id': '' });
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
    });

    it('should handle Redis connection errors gracefully', async () => {
      redisMock.get.mockRejectedValue(new Error('Redis connection failed'));

      const request = createMockRequest();
      const response = await GET(request);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual(
        expect.objectContaining({ error: 'Failed to fetch challenge' })
      );
    });
  });

  describe('POST/PUT /daily - Update Challenge Progress', () => {
    beforeEach(() => {
      // Setup: Existing challenge in cache
      const existingChallenge = JSON.stringify({
        ...mockChallengeData.basic,
        status: 0, // In progress
      });
      redisMock.get.mockResolvedValue(existingChallenge);
    });

    it('should update challenge progress via POST', async () => {
      const progressData = {
        progress: { wpm: 75, accuracy: 95 }
      };

      const request = createMockRequest({}, progressData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.progress).toEqual(progressData.progress);
      expect(redisMock.setEx).toHaveBeenCalled();
    });

    it('should update challenge progress via PUT', async () => {
      const progressData = { wpm: 80, accuracy: 98 };

      const request = createMockRequest({}, progressData);
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.progress).toEqual(progressData);
      expect(redisMock.setEx).toHaveBeenCalled();
    });

    it('should validate progress data format', async () => {
      const invalidData = { invalid: 'data' };

      const request = createMockRequest({}, invalidData);
      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid input data' });
    });

    it('should handle expired challenges', async () => {
      const expiredChallenge = JSON.stringify({
        ...mockChallengeData.basic,
        date: '2023-01-01', // Old date
      });
      redisMock.get.mockResolvedValue(expiredChallenge);

      const request = createMockRequest({}, { progress: { wpm: 70, accuracy: 90 } });
      const response = await POST(request);

      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: 'Challenge expired' });
    });

    it('should return 404 for non-existent challenges', async () => {
      redisMock.get.mockResolvedValue(null);

      const request = createMockRequest({}, { progress: { wpm: 70, accuracy: 90 } });
      const response = await POST(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Challenge not found' });
    });
  });

  describe('DELETE /daily - Remove Challenge', () => {
    it('should delete existing challenge', async () => {
      redisMock.exists.mockResolvedValue(1);
      redisMock.del.mockResolvedValue(1);

      const request = createMockRequest();
      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Challenge deleted successfully');
      expect(redisMock.del).toHaveBeenCalled();
    });

    it('should handle deletion of non-existent challenge', async () => {
      redisMock.exists.mockResolvedValue(0);

      const request = createMockRequest();
      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('No challenge found');
    });

    it('should require authorization for deletion', async () => {
      const request = createMockRequest({ 'x-user-id': 'invalid' });
      const response = await DELETE(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
    });
  });

  describe('GET /daily/[challengeId] - Get Specific Challenge', () => {
    it('should return specific challenge by ID', async () => {
      const challenge = mockChallengeData.basic;
      redisMock.get.mockResolvedValue(JSON.stringify(challenge));

      const request = createMockRequest();
      const params = createMockParams(challenge.id);
      const response = await getChallengeById(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe(challenge.id);
    });

    it('should return 404 for mismatched challenge ID', async () => {
      const challenge = mockChallengeData.basic;
      redisMock.get.mockResolvedValue(JSON.stringify(challenge));

      const request = createMockRequest();
      const params = createMockParams('different-id');
      const response = await getChallengeById(request, { params });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Challenge ID mismatch' });
    });

    it('should return 404 when challenge not found', async () => {
      redisMock.get.mockResolvedValue(null);

      const request = createMockRequest();
      const params = createMockParams('non-existent-id');
      const response = await getChallengeById(request, { params });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Challenge not found' });
    });
  });

  describe('PUT /daily/[challengeId] - Update Specific Challenge', () => {
    it('should update challenge with session data', async () => {
      const challenge = { ...mockChallengeData.speedCombo, status: 0 };
      redisMock.get.mockResolvedValue(JSON.stringify(challenge));

      const sessionData = { session: mockSessionData.basic };
      const request = createMockRequest({}, sessionData);
      const params = createMockParams(challenge.id);
      
      const response = await putChallengeById(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe(challenge.id);
      expect(redisMock.setEx).toHaveBeenCalled();
    });

    it('should handle different challenge types', async () => {
      const marathonChallenge = mockChallengeData.marathon;
      redisMock.get.mockResolvedValue(JSON.stringify(marathonChallenge));

      const sessionData = { 
        session: { 
          ...mockSessionData.basic,
          textLength: 200 // For marathon challenges
        }
      };
      
      const request = createMockRequest({}, sessionData);
      const params = createMockParams(marathonChallenge.id);
      
      const response = await putChallengeById(request, { params });

      expect(response.status).toBe(200);
    });

    it('should validate session data format', async () => {
      const challenge = mockChallengeData.basic;
      redisMock.get.mockResolvedValue(JSON.stringify(challenge));

      const invalidSession = { session: { invalid: 'data' } };
      const request = createMockRequest({}, invalidSession);
      const params = createMockParams(challenge.id);
      
      const response = await putChallengeById(request, { params });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(
        expect.objectContaining({ error: 'Invalid session data. WPM and accuracy are required.' })
      );
    });

    it('should reject expired challenges', async () => {
      const expiredChallenge = {
        ...mockChallengeData.basic,
        date: '2023-01-01'
      };
      redisMock.get.mockResolvedValue(JSON.stringify(expiredChallenge));

      const sessionData = { session: mockSessionData.basic };
      const request = createMockRequest({}, sessionData);
      const params = createMockParams(expiredChallenge.id);
      
      const response = await putChallengeById(request, { params });

      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: 'Challenge has expired' });
    });

    it('should require valid challenge ID parameter', async () => {
      const request = createMockRequest({}, { session: mockSessionData.basic });
      const params = createMockParams('');
      
      const response = await putChallengeById(request, { params });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Challenge ID is required' });
    });
  });

  describe('Challenge Completion Logic', () => {
    it('should mark speedCombo challenge as complete when targets met', async () => {
      const challenge = {
        ...mockChallengeData.basic,
        type: 'speedCombo' as const,
        target: { wpm: 60, accuracy: 90 },
        status: 0
      };
      redisMock.get.mockResolvedValue(JSON.stringify(challenge));

      // Session that meets requirements
      const sessionData = { 
        session: { wpm: 70, accuracy: 95, textLength: 100, timeSpent: 120 }
      };
      
      const request = createMockRequest({}, sessionData);
      const params = createMockParams(challenge.id);
      
      const response = await putChallengeById(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.completed).toBe(true);
    });

    it('should keep challenge in progress when targets not met', async () => {
      const challenge = {
        ...mockChallengeData.basic,
        type: 'speedCombo' as const,
        target: { wpm: 80, accuracy: 95 },
        status: 0
      };
      redisMock.get.mockResolvedValue(JSON.stringify(challenge));

      // Session that doesn't meet requirements
      const sessionData = { 
        session: { wpm: 70, accuracy: 90, textLength: 100, timeSpent: 120 }
      };
      
      const request = createMockRequest({}, sessionData);
      const params = createMockParams(challenge.id);
      
      const response = await putChallengeById(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.completed).toBe(false);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed JSON requests', async () => {
      const request = createMockRequest();
      (request as any).json = jest.fn().mockRejectedValue(new Error('Invalid JSON'));

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should handle Redis timeouts gracefully', async () => {
      redisMock.get.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      const request = createMockRequest();
      const response = await GET(request);

      expect(response.status).toBe(500);
    });

    it('should validate user authentication properly', async () => {
      const invalidUsers = ['', 'null', 'undefined', null];

      for (const userId of invalidUsers) {
        const request = createMockRequest({ 'x-user-id': userId as string });
        const response = await GET(request);
        
        expect(response.status).toBe(401);
      }
    });

    it('should handle concurrent updates safely', async () => {
      const challenge = mockChallengeData.basic;
      redisMock.get.mockResolvedValue(JSON.stringify(challenge));

      const sessionData = { session: mockSessionData.basic };
      const requests = Array(5).fill(null).map(() => 
        createMockRequest({}, sessionData)
      );

      const responses = await Promise.all(
        requests.map(req => POST(req))
      );

      // All requests should complete successfully
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Redis should be called for each request
      expect(redisMock.setEx).toHaveBeenCalledTimes(5);
    });
  });
});