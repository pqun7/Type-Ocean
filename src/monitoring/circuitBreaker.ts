// circuitBreaker.ts
/**
 * Circuit Breaker implementation for production monitoring and API health management
 * Prevents cascading failures and provides fallback mechanisms
 */

import "server-only";

import { productionMonitor } from "./productionHealthMonitor";
import { logger } from "@/log/ServerLogger";

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringWindow: number;
  minimumRequests?: number;
  name?: string;
  onStateChange?: (state: CircuitState, error?: Error) => void;
}

interface CircuitBreakerMetrics {
  successCount: number;
  failureCount: number;
  requestCount: number;
  lastFailureTime: number;
  lastSuccessTime: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private metrics: CircuitBreakerMetrics = {
    successCount: 0,
    failureCount: 0,
    requestCount: 0,
    lastFailureTime: 0,
    lastSuccessTime: Date.now()
  };
  
  private readonly config: Required<CircuitBreakerConfig>;
  private readonly name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = {
      failureThreshold: 5,
      resetTimeout: 60000,
      monitoringWindow: 300000,
      minimumRequests: 10,
      name: name,
      onStateChange: () => {},
      ...config
    };

    // Validate configuration
    if (this.config.failureThreshold <= 0 || this.config.failureThreshold > 100) {
      throw new Error(`Invalid failureThreshold: ${this.config.failureThreshold}. Must be between 1 and 100.`);
    }
    if (this.config.resetTimeout <= 0) {
      throw new Error(`Invalid resetTimeout: ${this.config.resetTimeout}. Must be greater than 0.`);
    }
    if (this.config.minimumRequests <= 0) {
      throw new Error(`Invalid minimumRequests: ${this.config.minimumRequests}. Must be greater than 0.`);
    }
  }

  /**
   * Executes a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
      } else {
        if (fallback) {
          return await fallback();
        }
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.onFailure(errorObj);
      
      // Check if circuit opened after failure and use fallback if available
      // Use type assertion since onFailure() can change state to OPEN
      if (fallback && (this.state as CircuitState) === 'OPEN') {
        return await fallback();
      }
      throw error;
    }
  }

  private onSuccess(): void {
    this.metrics.successCount++;
    this.metrics.requestCount++;
    this.metrics.lastSuccessTime = Date.now();
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.config.onStateChange?.(this.state);
      this.resetMetrics();
    }
  }

  private onFailure(error: Error): void {
    this.metrics.failureCount++;
    this.metrics.requestCount++;
    this.metrics.lastFailureTime = Date.now();

    if (this.shouldOpenCircuit()) {
      this.state = 'OPEN';
      this.config.onStateChange?.(this.state, error);
    }
  }

  private shouldOpenCircuit(): boolean {
    if (this.metrics.requestCount < this.config.minimumRequests) {
      return false;
    }

    const failureRate = (this.metrics.failureCount / this.metrics.requestCount) * 100;
    return failureRate >= this.config.failureThreshold;
  }

  private shouldAttemptReset(): boolean {
    return Date.now() - this.metrics.lastFailureTime >= this.config.resetTimeout;
  }

  private resetMetrics(): void {
    this.metrics = {
      successCount: 0,
      failureCount: 0,
      requestCount: 0,
      lastFailureTime: 0,
      lastSuccessTime: Date.now()
    };
  }

  /**
   * Get current circuit breaker status and metrics
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      metrics: { ...this.metrics },
      config: this.config,
      healthScore: this.calculateHealthScore()
    };
  }

  private calculateHealthScore(): number {
    if (this.metrics.requestCount === 0) return 100;
    return Math.max(0, 100 - (this.metrics.failureCount / this.metrics.requestCount) * 100);
  }
}

// Enhanced circuit breaker with production monitoring integration
export class EnhancedCircuitBreaker extends CircuitBreaker {
  private serviceName: string;
  private endpoint: string;

  constructor(config: CircuitBreakerConfig & { serviceName: string; endpoint: string }) {
    super(config.name || config.serviceName, config);
    this.serviceName = config.serviceName;
    this.endpoint = config.endpoint;
  }

  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await super.execute(operation, fallback);
      
      const duration = Date.now() - startTime;
      productionMonitor.recordApiHealth(
        this.serviceName,
        this.endpoint,
        'success',
        duration
      );
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      let status: 'failure' | 'timeout' = 'failure';
      if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
        status = 'timeout';
      }
      
      productionMonitor.recordApiHealth(
        this.serviceName,
        this.endpoint,
        status,
        duration,
        errorMessage
      );
      
      throw error;
    }
  }
}

// Singleton circuit breakers for different services
export const challengeApiCircuit = new CircuitBreaker('ChallengeAPI', {
  failureThreshold: 30,
  resetTimeout: 30000,
  minimumRequests: 5
});

export const sessionStatsCircuit = new CircuitBreaker('SessionStats', {
  failureThreshold: 20,
  resetTimeout: 30000,
  monitoringWindow: 60000,
  onStateChange: (state, error) => {
    logger.warn(
      `SessionStats Circuit Breaker state changed to ${state}`,
      { 
        context: "circuitBreaker",
        state, 
        error: error?.message, 
        timestamp: Date.now() 
      }
    );
  }
});

export const dailyChallengeCircuit = new CircuitBreaker('DailyChallenge', {
  failureThreshold: 25,
  resetTimeout: 60000,
  monitoringWindow: 120000,
  onStateChange: (state, error) => {
    logger.warn(
      `DailyChallenge Circuit Breaker state changed to ${state}`,
      { 
        context: "circuitBreaker",
        state, 
        error: error?.message, 
        timestamp: Date.now() 
      }
    );
  }
});

// Enhanced circuit breakers for specific services
// in circuitBreaker.ts file 
export const enhancedSessionStatsCircuit = new EnhancedCircuitBreaker({
  failureThreshold: 20,
  resetTimeout: 30000,
  monitoringWindow: 60000,
  name: "EnhancedSessionStats",
  serviceName: "SessionStats",
  endpoint: "/api/session-stats/v1",
  onStateChange: (state, error) => {
    logger.warn(
      `Enhanced SessionStats Circuit Breaker state changed to ${state}`,
      { 
        context: "enhancedCircuitBreaker",
        state, 
        error: error?.message, 
        timestamp: Date.now(),
        serviceName: "SessionStats",
        endpoint: "/api/session-stats/v1"
      }
    );
  }
});

export const enhancedDailyChallengeCircuit = new EnhancedCircuitBreaker({
  failureThreshold: 25,
  resetTimeout: 60000,
  monitoringWindow: 120000,
  name: "EnhancedDailyChallenge",
  serviceName: "DailyChallenge",
  endpoint: "/api/daily-challenge/v1",
  onStateChange: (state, error) => {
    logger.warn(
      `Enhanced DailyChallenge Circuit Breaker state changed to ${state}`,
      { 
        context: "enhancedCircuitBreaker",
        state, 
        error: error?.message, 
        timestamp: Date.now(),
        serviceName: "DailyChallenge",
        endpoint: "/api/daily-challenge/v1"
      }
    );
  }
});

// Export production monitor instance
export { productionMonitor } from "./productionHealthMonitor";