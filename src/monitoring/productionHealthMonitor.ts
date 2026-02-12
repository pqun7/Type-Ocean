import "server-only";

// src/monitoring/productionHealthMonitor.ts
import { logger } from "@/log/ServerLogger";

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

export class ProductionHealthMonitor {
  private healthMetrics: Map<string, APIHealthMetrics[]> = new Map();
  private serviceStatus: Map<string, ServiceHealthStatus> = new Map();
  private readonly maxMetricsHistory = 100;
  private readonly healthCheckInterval = 30000; // 30 seconds
  private healthCheckTimer?: NodeJS.Timeout;

  constructor() {
    this.startHealthMonitoring();
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

    // Update service status
    this.updateServiceStatus(serviceKey, metrics);

    // Log critical failures
    if (status === 'failure' || status === 'timeout') {
      logger.error(
        `API Health Alert: ${service} ${endpoint} failed`,
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
  getServiceHealth(service: string, endpoint: string): ServiceHealthStatus | null {
    const serviceKey = `${service}:${endpoint}`;
    return this.serviceStatus.get(serviceKey) || null;
  }

  /**
   * Gets overall system health status
   */
  getOverallHealth(): {
    isHealthy: boolean;
    unhealthyServices: string[];
    totalServices: number;
    healthyServices: number;
  } {
    const allServices = Array.from(this.serviceStatus.entries());
    const unhealthyServices = allServices
      .filter(([_, status]) => !status.isHealthy)
      .map(([service, _]) => service);

    return {
      isHealthy: unhealthyServices.length === 0,
      unhealthyServices,
      totalServices: allServices.length,
      healthyServices: allServices.length - unhealthyServices.length
    };
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
    const overallHealth = this.getOverallHealth();
    
    if (!overallHealth.isHealthy) {
      logger.warn(
        "System Health Alert: Unhealthy services detected",
        {
          context: "ProductionHealthMonitor",
          unhealthyServices: overallHealth.unhealthyServices,
          totalServices: overallHealth.totalServices,
          healthyServices: overallHealth.healthyServices,
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

    logger.info(
      "Production Health Summary",
      {
        context: "ProductionHealthMonitor",
        timestamp: new Date().toISOString(),
        services,
        overallHealth: this.getOverallHealth()
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
export const productionMonitor = new ProductionHealthMonitor();