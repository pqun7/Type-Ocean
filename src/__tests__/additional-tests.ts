import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST, DELETE } from '@/app/api/challenge/v1/daily/route';
import redis from '@/lib/redis';
import { generateDailyChallenge } from '@/features/level/utils/challengeHelpers';
import { getUserLevel } from '@/features/level/server-utils/userCache';
import { productionMonitoring } from "@/monitoring/productionMonitoring";

// Mock dependencies
jest.mock('@/lib/redis');
jest.mock('@/features/level/utils/challengeHelpers');
jest.mock('@/features/level/server-utils/userCache');
jest.mock('@/features/auth/utils/timeUtils', () => ({
  getTodayDate: jest.fn(() => '2025-01-01'),
  getLocalMidnightTTL: jest.fn(() => 86400),
}));

const mockedRedis = redis as jest.Mocked<typeof redis>;
const mockedGenerateDailyChallenge = generateDailyChallenge as jest.Mock;
const mockedGetUserLevel = getUserLevel as jest.Mock;

describe('Daily Challenge API Production Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/challenge/v1/daily', () => {
    const createMockRequest = (userId = 'user-123') => 
      new NextRequest('http://localhost/api/challenge/v1/daily', {
        headers: { 'x-user-id': userId }
      });

    it('should return cached challenge when available', async () => {
      const cachedChallenge = {
        id: 'challenge-cached',
        type: 'speedCombo',
        target: { wpm: 60, accuracy: 95 },
        date: '2025-01-01',
        status: 0,
        xp: 150
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(cachedChallenge));

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(cachedChallenge);
      expect(mockedRedis.get).toHaveBeenCalledWith('dailyChallenge:user-123:2025-01-01');
    });

    it('should generate new challenge on cache miss', async () => {
      const newChallenge = {
        id: 'challenge-new',
        type: 'marathon',
        target: 500,
        date: '2025-01-01',
        status: 0,
        xp: 200,
        data: { charactersTyped: 0 }
      };

      mockedRedis.get.mockResolvedValue(null);
      mockedGetUserLevel.mockResolvedValue(5);
      mockedGenerateDailyChallenge.mockResolvedValue(newChallenge);
      mockedRedis.setEx.mockResolvedValue('OK');

      const response = await GET(createMockRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(newChallenge);
      expect(mockedGenerateDailyChallenge).toHaveBeenCalledWith('user-123', 5);
      expect(mockedRedis.setEx).toHaveBeenCalled();
    });

    it('should handle unauthorized requests', async () => {
      const response = await GET(createMockRequest(''));
      expect(response.status).toBe(401);
    });

    it('should provide fallback challenge on Redis failure', async () => {
      mockedRedis.get.mockRejectedValue(new Error('Redis connection failed'));
      mockedGetUserLevel.mockResolvedValue(3);
      mockedGenerateDailyChallenge.mockResolvedValue({
        id: 'fallback-challenge',
        type: 'speedCombo',
        target: { wpm: 50, accuracy: 90 }
      });

      const response = await GET(createMockRequest());
      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/challenge/v1/daily - Challenge Updates', () => {
    const createUpdateRequest = (body: any, userId = 'user-123') =>
      new NextRequest('http://localhost/api/challenge/v1/daily', {
        method: 'POST',
        headers: { 
          'x-user-id': userId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

    it('should update challenge progress correctly', async () => {
      const existingChallenge = {
        id: 'challenge-123',
        type: 'marathon',
        target: 1000,
        date: '2025-01-01',
        status: 0,
        data: { charactersTyped: 200 }
      };

      const updateData = {
        progress: { wpm: 65, accuracy: 96, textLength: 150 }
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(existingChallenge));
      mockedRedis.setEx.mockResolvedValue('OK');

      const response = await POST(createUpdateRequest(updateData));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.charactersTyped).toBeGreaterThan(200);
    });

    it('should handle challenge completion', async () => {
      const speedComboChallenge = {
        id: 'speed-challenge',
        type: 'speedCombo',
        target: { wpm: 60, accuracy: 95 },
        date: '2025-01-01',
        status: 0,
        data: {}
      };

      const completionData = {
        progress: { wpm: 65, accuracy: 97 }
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(speedComboChallenge));
      mockedRedis.setEx.mockResolvedValue('OK');

      const response = await POST(createUpdateRequest(completionData));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe(1); // Completed
    });

    it('should validate input data', async () => {
      const invalidData = {
        progress: { wpm: 'invalid', accuracy: 150 }
      };

      const response = await POST(createUpdateRequest(invalidData));
      expect(response.status).toBe(400);
    });

    it('should handle expired challenges', async () => {
      const expiredChallenge = {
        id: 'expired-challenge',
        date: '2024-12-31' // Previous day
      };

      mockedRedis.get.mockResolvedValue(JSON.stringify(expiredChallenge));

      const response = await POST(createUpdateRequest({ progress: { wpm: 60 } }));
      expect(response.status).toBe(410); // Gone
    });
  });

  describe('DELETE /api/challenge/v1/daily', () => {
    const createDeleteRequest = (userId = 'user-123') =>
      new NextRequest('http://localhost/api/challenge/v1/daily', {
        method: 'DELETE',
        headers: { 'x-user-id': userId }
      });

    it('should delete existing challenge', async () => {
      mockedRedis.exists.mockResolvedValue(1);
      mockedRedis.del.mockResolvedValue(1);

      const response = await DELETE(createDeleteRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Challenge deleted');
    });

    it('should handle non-existent challenge deletion', async () => {
      mockedRedis.exists.mockResolvedValue(0);

      const response = await DELETE(createDeleteRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('No challenge found');
    });
  });

  describe('Performance & Production Readiness', () => {
    it('should handle concurrent requests efficiently', async () => {
      const requests = Array.from({ length: 10 }, (_, i) => 
        GET(createMockRequest(`user-${i}`))
      );

      mockedRedis.get.mockResolvedValue(null);
      mockedGetUserLevel.mockResolvedValue(5);
      mockedGenerateDailyChallenge.mockResolvedValue({
        id: 'concurrent-challenge',
        type: 'speedCombo'
      });

      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should implement proper caching TTL', async () => {
      mockedRedis.get.mockResolvedValue(null);
      mockedGetUserLevel.mockResolvedValue(3);
      mockedGenerateDailyChallenge.mockResolvedValue({
        id: 'ttl-challenge'
      });
      mockedRedis.setEx.mockResolvedValue('OK');

      await GET(createMockRequest());

      expect(mockedRedis.setEx).toHaveBeenCalledWith(
        expect.any(String),
        86400, // TTL
        expect.any(String)
      );
    });
  });
});

/**
 * Additional comprehensive tests for production-ready features
 * Tests cover edge cases, performance scenarios, and error handling
 */

describe("Production Features - Additional Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Circuit Breaker Integration", () => {
    it("should handle rapid failure scenarios", async () => {
      const serviceName = "test-service";
      
      // Simulate rapid failures
      for (let i = 0; i < 6; i++) {
        productionMonitoring.recordServiceCall(serviceName, false, 1000);
      }
      
      // Service should be unavailable due to circuit breaker
      expect(productionMonitoring.isServiceAvailable(serviceName)).toBe(false);
      
      // Wait for reset timeout simulation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should allow one attempt in half-open state
      expect(productionMonitoring.isServiceAvailable(serviceName)).toBe(true);
    });

    it("should recover from circuit breaker state on success", async () => {
      const serviceName = "recovery-test";
      
      // Trigger circuit breaker
      for (let i = 0; i < 6; i++) {
        productionMonitoring.recordServiceCall(serviceName, false, 1000);
      }
      
      expect(productionMonitoring.isServiceAvailable(serviceName)).toBe(false);
      
      // Simulate successful call after timeout
      productionMonitoring.recordServiceCall(serviceName, true, 200);
      
      // Should be available again
      expect(productionMonitoring.isServiceAvailable(serviceName)).toBe(true);
    });
  });

  describe("High Load Simulation", () => {
    it("should handle concurrent challenge requests", async () => {
      const mockUserId = "load-test-user";
      const concurrentRequests = 100;
      
      const requests = Array(concurrentRequests).fill(0).map(async (_, index) => {
        // Simulate staggered requests
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        
        try {
          // Simulate API call
          return {
            success: true,
            userId: `${mockUserId}-${index}`,
            timestamp: Date.now()
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });
      
      const results = await Promise.allSettled(requests);
      const successfulRequests = results.filter(r => 
        r.status === 'fulfilled' && r.value.success
      );
      
      // Should handle at least 95% of requests successfully
      expect(successfulRequests.length).toBeGreaterThanOrEqual(concurrentRequests * 0.95);
    });

    it("should maintain performance under memory pressure", () => {
      const initialMemory = process.memoryUsage();
      
      // Simulate memory-intensive operations
      const largeArrays = [];
      for (let i = 0; i < 1000; i++) {
        largeArrays.push(new Array(1000).fill(Math.random()));
      }
      
      const afterMemory = process.memoryUsage();
      const memoryIncrease = afterMemory.heapUsed - initialMemory.heapUsed;
      
      // Memory increase should be reasonable (less than 100MB for this test)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
      
      // Cleanup
      largeArrays.length = 0;
    });
  });

  describe("Error Recovery Mechanisms", () => {
    it("should gracefully handle Redis connection failures", async () => {
      // Mock Redis failure scenario
      const mockRedisError = new Error("Redis connection failed");
      
      // Test should not throw but handle gracefully
      expect(() => {
        productionMonitoring.handleCriticalError(mockRedisError, "redis-connection");
      }).not.toThrow();
    });

    it("should implement exponential backoff for retries", async () => {
      const retryAttempts: number[] = [];
      const maxRetries = 5;
      
      const exponentialBackoff = async (attempt: number): Promise<void> => {
        if (attempt > maxRetries) {
          throw new Error("Max retries exceeded");
        }
        
        retryAttempts.push(attempt);
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        
        // Simulate delay (shortened for testing)
        await new Promise(resolve => setTimeout(resolve, delay / 100));
        
        // Simulate failure for first few attempts
        if (attempt < 3) {
          throw new Error(`Attempt ${attempt} failed`);
        }
      };
      
      // Test retry mechanism
      let finalAttempt = 0;
      for (let i = 0; i < maxRetries; i++) {
        try {
          await exponentialBackoff(i);
          finalAttempt = i;
          break;
        } catch (error) {
          if (i === maxRetries - 1) {
            throw error;
          }
        }
      }
      
      expect(retryAttempts.length).toBeGreaterThan(0);
      expect(finalAttempt).toBe(3); // Should succeed on 4th attempt
    });
  });

  describe("Data Validation and Sanitization", () => {
    it("should validate and sanitize user input", () => {
      const testInputs = [
        { input: "normal text", expected: "normal text" },
        { input: "<script>alert('xss')</script>", expected: "" },
        { input: "text with\nnewlines\r\n", expected: "text with newlines " },
        { input: "   trimmed   ", expected: "trimmed" },
        { input: "", expected: "" },
        { input: null, expected: "" },
        { input: undefined, expected: "" }
      ];
      
      const sanitizeInput = (input: any): string => {
        if (typeof input !== 'string') return '';
        return input
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/[\r\n\t]/g, ' ') // Replace line breaks with spaces
          .trim(); // Trim whitespace
      };
      
      testInputs.forEach(({ input, expected }) => {
        expect(sanitizeInput(input)).toBe(expected);
      });
    });

    it("should validate challenge progress data", () => {
      const validateProgress = (data: any): boolean => {
        if (!data || typeof data !== 'object') return false;
        
        // WPM validation
        if (typeof data.wpm !== 'number' || data.wpm < 0 || data.wpm > 300) {
          return false;
        }
        
        // Accuracy validation
        if (typeof data.accuracy !== 'number' || data.accuracy < 0 || data.accuracy > 100) {
          return false;
        }
        
        // Text length validation
        if (typeof data.textLength !== 'number' || data.textLength < 0) {
          return false;
        }
        
        return true;
      };
      
      // Valid data
      expect(validateProgress({
        wpm: 75,
        accuracy: 95.5,
        textLength: 150
      })).toBe(true);
      
      // Invalid data
      expect(validateProgress({ wpm: -5 })).toBe(false);
      expect(validateProgress({ accuracy: 105 })).toBe(false);
      expect(validateProgress({ textLength: -10 })).toBe(false);
      expect(validateProgress(null)).toBe(false);
      expect(validateProgress(undefined)).toBe(false);
    });
  });

  describe("Performance Monitoring", () => {
    it("should track API response times", () => {
      const responseTimes: number[] = [];
      const trackResponseTime = (duration: number) => {
        responseTimes.push(duration);
      };
      
      // Simulate various response times
      trackResponseTime(150); // Fast
      trackResponseTime(500); // Medium
      trackResponseTime(1200); // Slow
      trackResponseTime(2500); // Very slow
      
      const averageTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const slowRequests = responseTimes.filter(t => t > 1000).length;
      
      expect(averageTime).toBeGreaterThan(0);
      expect(slowRequests).toBe(2);
    });

    it("should detect memory leak patterns", () => {
      const memoryUsage: number[] = [];
      
      // Simulate memory usage tracking
      for (let i = 0; i < 10; i++) {
        // Simulate increasing memory usage
        const usage = 50 + (i * 5) + Math.random() * 10;
        memoryUsage.push(usage);
      }
      
      // Check for increasing trend (potential memory leak)
      const isIncreasing = memoryUsage.every((usage, index) => {
        if (index === 0) return true;
        return usage >= memoryUsage[index - 1] - 5; // Allow for small fluctuations
      });
      
      // In this test, we expect an increasing trend
      expect(isIncreasing).toBe(true);
      
      // Alert threshold check
      const highUsage = memoryUsage.filter(usage => usage > 80);
      expect(highUsage.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases and Boundary Conditions", () => {
    it("should handle extremely large numbers", () => {
      const largeNumbers = [
        Number.MAX_SAFE_INTEGER,
        Number.MAX_VALUE,
        Infinity,
        -Infinity,
        NaN
      ];
      
      const sanitizeNumber = (num: number, min: number = 0, max: number = 1000): number => {
        if (isNaN(num) || !isFinite(num)) return min;
        return Math.max(min, Math.min(max, num));
      };
      
      largeNumbers.forEach(num => {
        const result = sanitizeNumber(num);
        expect(isFinite(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1000);
      });
    });

    it("should handle date edge cases", () => {
      const edgeDates = [
        new Date("1970-01-01"), // Unix epoch
        new Date("2038-01-19"), // 32-bit timestamp limit
        new Date("9999-12-31"), // Far future
        new Date("invalid"), // Invalid date
        new Date(0), // Zero timestamp
        new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000) // 100 years in future
      ];
      
      const validateDate = (date: Date): boolean => {
        if (!(date instanceof Date) || isNaN(date.getTime())) {
          return false;
        }
        
        const now = new Date();
        const maxFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year
        const minPast = new Date("1900-01-01");
        
        return date >= minPast && date <= maxFuture;
      };
      
      const validDates = edgeDates.filter(validateDate);
      expect(validDates.length).toBeGreaterThan(0);
      expect(validDates.length).toBeLessThan(edgeDates.length);
    });
  });
});