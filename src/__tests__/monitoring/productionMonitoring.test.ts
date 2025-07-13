/**
 * Tests for Production Monitoring System
 * Validates circuit breaker patterns and health monitoring
 */

import { productionMonitoring } from '@/monitoring/productionMonitoring';

// Mock the logger to avoid console output during tests
jest.mock('@/log/clientLogger', () => ({
  logger: {
    monitoring: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    },
  },
}));

describe('Production Monitoring System', () => {
  beforeEach(() => {
    // Reset monitoring state
    jest.clearAllMocks();
    // Reset environment for testing
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  describe('Circuit Breaker', () => {
    it('should allow service calls when circuit is closed', () => {
      const isAvailable = productionMonitoring.isServiceAvailable('redis');
      expect(isAvailable).toBe(true);
    });

    it('should open circuit after threshold failures', () => {
      const serviceName = 'test-service';
      const failureThreshold = 5;

      // Simulate multiple failures
      for (let i = 0; i < failureThreshold; i++) {
        productionMonitoring.recordServiceCall(serviceName, false, 1000);
      }

      // Circuit should be open now
      const isAvailable = productionMonitoring.isServiceAvailable(serviceName);
      expect(isAvailable).toBe(false);
    });

    it('should transition to half-open after timeout', async () => {
      const serviceName = 'timeout-test';
      
      // Force circuit to open
      for (let i = 0; i < 5; i++) {
        productionMonitoring.recordServiceCall(serviceName, false, 1000);
      }

      // Wait for reset timeout (mocked)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should allow one test call
      const isAvailable = productionMonitoring.isServiceAvailable(serviceName);
      expect(isAvailable).toBe(true);
    });

    it('should close circuit on successful half-open call', () => {
      const serviceName = 'recovery-test';
      
      // Open circuit
      for (let i = 0; i < 5; i++) {
        productionMonitoring.recordServiceCall(serviceName, false, 1000);
      }

      // Simulate successful recovery
      productionMonitoring.recordServiceCall(serviceName, true, 200);
      
      const isAvailable = productionMonitoring.isServiceAvailable(serviceName);
      expect(isAvailable).toBe(true);
    });
  });

  describe('Health Monitoring', () => {
    it('should report healthy status for good services', () => {
      productionMonitoring.recordServiceCall('redis', true, 100);
      productionMonitoring.recordServiceCall('database', true, 150);

      const health = productionMonitoring.getSystemHealth();
      expect(health.status).toBe('healthy');
    });

    it('should report degraded status for slow services', () => {
      productionMonitoring.recordServiceCall('redis', true, 1500); // Slow but working

      const health = productionMonitoring.getSystemHealth();
      const redisService = health.services.find(s => s.name === 'redis');
      
      expect(redisService?.status).toBe('degraded');
    });

    it('should report down status for failing services', () => {
      // Multiple failures to mark service as down
      for (let i = 0; i < 3; i++) {
        productionMonitoring.recordServiceCall('database', false, 0);
      }

      const health = productionMonitoring.getSystemHealth();
      const dbService = health.services.find(s => s.name === 'database');
      
      expect(dbService?.status).toBe('down');
    });

    it('should provide comprehensive health report', () => {
      const health = productionMonitoring.getSystemHealth();
      
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('services');
      expect(health).toHaveProperty('circuitBreakers');
      expect(health).toHaveProperty('metrics');
      
      expect(Array.isArray(health.services)).toBe(true);
      expect(typeof health.circuitBreakers).toBe('object');
    });
  });

  describe('API Performance Monitoring', () => {
    it('should monitor successful API calls', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      productionMonitoring.monitorApiPerformance('/api/challenge', 'GET', 200, 150);
      
      // Should not warn for good performance
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      
      consoleWarnSpy.mockRestore();
    });

    it('should detect slow API responses', () => {
      productionMonitoring.monitorApiPerformance('/api/challenge', 'GET', 200, 3000);
      
      // Should log warning for slow response
      const { logger } = require('@/log/clientLogger');
      expect(logger.monitoring.warn).toHaveBeenCalledWith(
        'API performance issue',
        'productionMonitoring.ts',
        expect.objectContaining({
          endpoint: '/api/challenge',
          responseTime: 3000,
        })
      );
    });

    it('should detect API errors', () => {
      productionMonitoring.monitorApiPerformance('/api/challenge', 'POST', 500, 100);
      
      const { logger } = require('@/log/clientLogger');
      expect(logger.monitoring.warn).toHaveBeenCalledWith(
        'API performance issue',
        'productionMonitoring.ts',
        expect.objectContaining({
          statusCode: 500,
        })
      );
    });
  });

  describe('Cache Performance', () => {
    it('should monitor good cache performance', () => {
      productionMonitoring.monitorCachePerformance('daily-challenge', 0.95, 50);
      
      const { logger } = require('@/log/clientLogger');
      expect(logger.monitoring.warn).not.toHaveBeenCalled();
    });

    it('should detect low cache hit rates', () => {
      productionMonitoring.monitorCachePerformance('user-level', 0.60, 200);
      
      const { logger } = require('@/log/clientLogger');
      expect(logger.monitoring.warn).toHaveBeenCalledWith(
        'Low cache hit rate',
        'productionMonitoring.ts',
        expect.objectContaining({
          hitRate: 0.60,
          recommendedAction: 'Consider cache optimization',
        })
      );
    });
  });

  describe('Critical Error Handling', () => {
    it('should handle critical system errors', () => {
      const testError = new Error('Database connection lost');
      
      productionMonitoring.handleCriticalError(testError, 'database-connection');
      
      const { logger } = require('@/log/clientLogger');
      expect(logger.monitoring.error).toHaveBeenCalledWith(
        'Critical system error',
        'productionMonitoring.ts',
        testError,
        expect.objectContaining({
          context: 'database-connection',
        })
      );
    });

    it('should trigger emergency protocols', () => {
      const criticalError = new Error('Memory exhausted');
      
      productionMonitoring.handleCriticalError(criticalError, 'memory-management');
      
      const { logger } = require('@/log/clientLogger');
      expect(logger.monitoring.error).toHaveBeenCalledWith(
        'Emergency protocol triggered',
        'productionMonitoring.ts',
        criticalError,
        expect.objectContaining({
          action: 'emergency_protocol_activated',
        })
      );
    });
  });

  describe('Development Environment', () => {
    it('should be disabled in development', () => {
      process.env.NODE_ENV = 'development';
      
      // Monitoring should be inactive
      productionMonitoring.recordServiceCall('test', false, 1000);
      productionMonitoring.monitorApiPerformance('/test', 'GET', 500, 3000);
      
      // Should not generate warnings in development
      const { logger } = require('@/log/clientLogger');
      expect(logger.monitoring.warn).not.toHaveBeenCalled();
    });
  });

  describe('Integration Tests', () => {
    it('should handle concurrent service calls', async () => {
      const promises = [];
      
      // Simulate concurrent load
      for (let i = 0; i < 10; i++) {
        promises.push(
          Promise.resolve().then(() => {
            productionMonitoring.recordServiceCall('concurrent-test', true, 100 + i * 10);
          })
        );
      }
      
      await Promise.all(promises);
      
      const health = productionMonitoring.getSystemHealth();
      const service = health.services.find(s => s.name === 'concurrent-test');
      
      expect(service?.status).toBe('healthy');
    });

    it('should maintain system health during mixed operations', () => {
      // Mix of successful and failed operations
      productionMonitoring.recordServiceCall('mixed-test', true, 150);
      productionMonitoring.recordServiceCall('mixed-test', false, 0);
      productionMonitoring.recordServiceCall('mixed-test', true, 200);
      productionMonitoring.monitorApiPerformance('/api/test', 'GET', 200, 300);
      productionMonitoring.monitorCachePerformance('test-cache', 0.85, 100);
      
      const health = productionMonitoring.getSystemHealth();
      expect(health.timestamp).toBeGreaterThan(0);
      expect(health.services.length).toBeGreaterThan(0);
    });
  });
});