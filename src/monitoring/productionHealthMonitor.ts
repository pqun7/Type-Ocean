// src/monitoring/productionHealthMonitor.ts
import { logger } from "@/log/clientLogger";

interface APIHealthMetrics {
  service: string;
  endpoint: string;
  status: 'success' | 'failure' | 'timeout';
  responseTime: number;
  timestamp: number;
  errorMessage?: string;
}

interface ServiceHealthStatus {
  isHealthy: boolean;
  lastCheck: number;
  consecutiveFailures: number;
  averageResponseTime: number;
  successRate: number;
  circuitState: 'OPEN' | 'CLOSED' | 'HALF_OPEN';
}

interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringWindow: number;
}

interface SystemHealthReport {
  status: 'healthy' | 'degraded' | 'down';
  timestamp: number;
  services: ServiceHealthStatus[];
  circuitBreakers: Record<string, CircuitBreakerState>;
  overallHealth: {
    isHealthy: boolean;
    unhealthyServices: string[];
    totalServices: number;
    healthyServices: number;
  };
}

export class ProductionHealthMonitor {
  private static instance: ProductionHealthMonitor;
  private healthMetrics: Map<string, APIHealthMetrics[]> = new Map();
  private serviceStatus: Map<string, ServiceHealthStatus> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private readonly maxMetricsHistory = 100;
  private readonly healthCheckInterval = 30000; // 30 seconds
  private healthCheckTimer?: NodeJS.Timeout;
  private isEnabled: boolean;

  private readonly config: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeout: 30000, // 30 seconds
    monitoringWindow: 60000, // 1 minute
  };

  constructor() {
    this.isEnabled = process.env.NODE_ENV === 'production';
    this.initializeServices();
    
    if (this.isEnabled) {
      this.startHealthMonitoring();
    }
  }

  static getInstance(): ProductionHealthMonitor {
    if (!ProductionHealthMonitor.instance) {
      ProductionHealthMonitor.instance = new ProductionHealthMonitor();
    }
    return ProductionHealthMonitor.instance;
  }

  /**
   * Initialize monitored services
   */
  private initializeServices(): void {
    const services = [
      'SessionStats:/api/session-stats/v1',
      'DailyChallenge:/api/challenge/v1/daily',
      'Redis:redis-connection',
      'Database:db-connection'
    ];
    
    services.forEach(serviceKey => {
      this.serviceStatus.set(serviceKey, {
        isHealthy: true,
        lastCheck: Date.now(),
        consecutiveFailures: 0,
        averageResponseTime: 0,
        successRate: 1.0,
        circuitState: 'CLOSED'
      });

      this.circuitBreakers.set(serviceKey, {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: 0,
        nextAttemptTime: 0
      });
    });
  }

  /**
   * Records API health metrics for production monitoring
   */
  recordApiHealth(
    service: string,
    endpoint: string,
    status: 'success' | 'failure' | 'timeout',
    responseTime: number,
    errorMessage?: string
  ): void {
    if (!this.isEnabled) return;

    const metric: APIHealthMetrics = {
      service,
      endpoint,
      status,
      responseTime,
      timestamp: Date.now(),
      errorMessage
    };

    const serviceKey = `${service}:${endpoint}`;
    
    if (!this.healthMetrics.has(serviceKey)) {
      this.healthMetrics.set(serviceKey, []);
    }

    const metrics = this.healthMetrics.get(serviceKey)!;
    metrics.push(metric);

    // Keep only recent metrics
    if (metrics.length > this.maxMetricsHistory) {
      metrics.shift();
    }

    // Update service status and circuit breaker
    this.updateServiceStatus(serviceKey, metrics);
    this.updateCircuitBreaker(serviceKey, status === 'success', responseTime);

    // Log critical failures
    if (status === 'failure' || status === 'timeout') {
      logger.session.error(
        `API Health Alert: ${service} ${endpoint} failed`,
        "ProductionHealthMonitor",
        new Error(errorMessage || `${status} detected`),
        {
          service,
          endpoint,
          status,
          responseTime,
          timestamp: metric.timestamp
        }
      );
    }
  }

  /**
   * Check if service is available through circuit breaker
   */
  isServiceAvailable(service: string, endpoint?: string): boolean {
    const serviceKey = endpoint ? `${service}:${endpoint}` : service;
    const breaker = this.circuitBreakers.get(serviceKey);
    if (!breaker) return true;

    const now = Date.now();

    switch (breaker.state) {
      case 'closed':
        return true;
      
      case 'open':
        if (now >= breaker.nextAttemptTime) {
          breaker.state = 'half-open';
          return true;
        }
        return false;
      
      case 'half-open':
        return true;
      
      default:
        return false;
    }
  }

  /**
   * Updates service health status based on recent metrics
   */
  private updateServiceStatus(serviceKey: string, metrics: APIHealthMetrics[]): void {
    const recentMetrics = metrics.slice(-20); // Last 20 requests
    const successCount = recentMetrics.filter(m => m.status === 'success').length;
    const successRate = successCount / recentMetrics.length;
    
    const averageResponseTime = recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / recentMetrics.length;
    
    const consecutiveFailures = this.countConsecutiveFailures(recentMetrics);
    
    const isHealthy = successRate >= 0.8 && consecutiveFailures < 3 && averageResponseTime < 5000;

    this.serviceStatus.set(serviceKey, {
      isHealthy,
      lastCheck: Date.now(),
      consecutiveFailures,
      averageResponseTime,
      successRate,
      circuitState: this.determineCircuitState(successRate, consecutiveFailures)
    });
  }

  /**
   * Updates circuit breaker state
   */
  private updateCircuitBreaker(serviceKey: string, success: boolean, responseTime: number): void {
    const breaker = this.circuitBreakers.get(serviceKey);
    if (!breaker) return;

    if (success) {
      // Reset circuit breaker on success
      if (breaker.state === 'half-open') {
        breaker.state = 'closed';
        breaker.failureCount = 0;
      }
    } else {
      // Update circuit breaker on failure
      breaker.failureCount++;
      breaker.lastFailureTime = Date.now();
      
      if (breaker.failureCount >= this.config.failureThreshold) {
        breaker.state = 'open';
        breaker.nextAttemptTime = Date.now() + this.config.resetTimeout;
        
        logger.session.error(
          'Circuit breaker opened',
          'ProductionHealthMonitor',
          new Error(`Service ${serviceKey} circuit breaker opened`),
          {
            serviceKey,
            failureCount: breaker.failureCount,
            resetTime: breaker.nextAttemptTime
          }
        );
      }
    }
  }

  /**
   * Counts consecutive failures from the end of metrics array
   */
  private countConsecutiveFailures(metrics: APIHealthMetrics[]): number {
    let count = 0;
    for (let i = metrics.length - 1; i >= 0; i--) {
      if (metrics[i].status === 'failure' || metrics[i].status === 'timeout') {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Determines circuit breaker state based on metrics
   */
  private determineCircuitState(successRate: number, consecutiveFailures: number): 'OPEN' | 'CLOSED' | 'HALF_OPEN' {
    if (consecutiveFailures >= 5 || successRate < 0.5) {
      return 'OPEN';
    } else if (consecutiveFailures >= 3 || successRate < 0.8) {
      return 'HALF_OPEN';
    }
    return 'CLOSED';
  }

  /**
   * Gets health status for a specific service
   */
  getServiceHealth(service: string, endpoint?: string): ServiceHealthStatus | null {
    const serviceKey = endpoint ? `${service}:${endpoint}` : service;
    return this.serviceStatus.get(serviceKey) || null;
  }

  /**
   * Gets comprehensive system health report
   */
  getSystemHealth(): SystemHealthReport {
    const services = Array.from(this.serviceStatus.values());
    const unhealthyServices = Array.from(this.serviceStatus.entries())
      .filter(([_, status]) => !status.isHealthy)
      .map(([service, _]) => service);
    
    let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
    
    if (unhealthyServices.length > 0) {
      const downServices = services.filter(s => s.consecutiveFailures >= 5);
      overallStatus = downServices.length > 0 ? 'down' : 'degraded';
    }

    const circuitBreakerStatus: Record<string, CircuitBreakerState> = {};
    this.circuitBreakers.forEach((state, name) => {
      circuitBreakerStatus[name] = { ...state };
    });

    return {
      status: overallStatus,
      timestamp: Date.now(),
      services,
      circuitBreakers: circuitBreakerStatus,
      overallHealth: {
        isHealthy: unhealthyServices.length === 0,
        unhealthyServices,
        totalServices: services.length,
        healthyServices: services.length - unhealthyServices.length
      }
    };
  }

  /**
   * Handle critical system errors
   */
  handleCriticalError(error: Error, context: string): void {
    if (!this.isEnabled) return;

    logger.session.error(
      'Critical system error',
      'ProductionHealthMonitor',
      error,
      {
        context,
        timestamp: Date.now(),
        systemHealth: this.getSystemHealth().status
      }
    );

    // Trigger emergency protocols if needed
    this.triggerEmergencyProtocol(error, context);
  }

  /**
   * Monitor API performance
   */
  monitorApiPerformance(endpoint: string, method: string, statusCode: number, responseTime: number): void {
    if (!this.isEnabled) return;

    const isSuccess = statusCode >= 200 && statusCode < 400;
    const isSlowResponse = responseTime > 2000;
    
    if (!isSuccess || isSlowResponse) {
      logger.session.warn(
        'API performance issue',
        'ProductionHealthMonitor',
        {
          endpoint,
          method,
          statusCode,
          responseTime,
          threshold: 2000
        }
      );
    }
  }

  /**
   * Starts periodic health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckInterval);
  }

  /**
   * Performs periodic health check and alerts
   */
  private performHealthCheck(): void {
    const systemHealth = this.getSystemHealth();
    
    if (!systemHealth.overallHealth.isHealthy) {
      logger.session.warn(
        "System Health Alert: Unhealthy services detected",
        "ProductionHealthMonitor",
        {
          unhealthyServices: systemHealth.overallHealth.unhealthyServices,
          totalServices: systemHealth.overallHealth.totalServices,
          healthyServices: systemHealth.overallHealth.healthyServices,
          timestamp: Date.now()
        }
      );
    }

    // Log health summary every 5 minutes
    if (Date.now() % (5 * 60 * 1000) < this.healthCheckInterval) {
      this.logHealthSummary();
    }
  }

  /**
   * Logs comprehensive health summary
   */
  private logHealthSummary(): void {
    const services = Array.from(this.serviceStatus.entries()).map(([service, status]) => ({
      service,
      isHealthy: status.isHealthy,
      successRate: Math.round(status.successRate * 100),
      avgResponseTime: Math.round(status.averageResponseTime),
      circuitState: status.circuitState
    }));

    logger.session.info(
      "Production Health Summary",
      "ProductionHealthMonitor",
      {
        timestamp: new Date().toISOString(),
        services,
        overallHealth: this.getSystemHealth().overallHealth
      }
    );
  }

  /**
   * Gets recent metrics for analysis
   */
  getRecentMetrics(service: string, endpoint: string, limit: number = 50): APIHealthMetrics[] {
    const serviceKey = `${service}:${endpoint}`;
    const metrics = this.healthMetrics.get(serviceKey) || [];
    return metrics.slice(-limit);
  }

  /**
   * Clears old metrics to prevent memory leaks
   */
  clearOldMetrics(): void {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    
    for (const [serviceKey, metrics] of this.healthMetrics.entries()) {
      const recentMetrics = metrics.filter(m => m.timestamp > cutoffTime);
      this.healthMetrics.set(serviceKey, recentMetrics);
    }
  }

  /**
   * Emergency protocol for critical failures
   */
  private triggerEmergencyProtocol(error: Error, context: string): void {
    // In production, implement:
    // - Circuit breaker activation
    // - Graceful degradation
    // - External alert systems
    logger.session.error(
      'Emergency protocol triggered',
      'ProductionHealthMonitor',
      error,
      {
        context,
        action: 'emergency_protocol_activated'
      }
    );
  }

  /**
   * Stops health monitoring
   */
  stopMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }
}

// Singleton instance for production monitoring
export const productionMonitor = ProductionHealthMonitor.getInstance();

// Export types for external use
export type { 
  SystemHealthReport, 
  ServiceHealthStatus, 
  APIHealthMetrics,
  CircuitBreakerState 
};