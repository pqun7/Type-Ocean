// src/monitoring/monitoringSystem.ts
import { logging } from "@/log/ServerLogger";


interface APIMetrics {
  endpoint: string;
  responseTime: number;
  statusCode: number;
  userId?: string;
  error?: string;
}

interface ChallengeMetrics {
  challengeId: string;
  generationTime: number;
  difficulty: number;
  cacheStatus: 'hit' | 'miss';
}

class MonitoringSystem {
  private static instance: MonitoringSystem;
  private metrics: APIMetrics[] = [];
  private challengeStats: ChallengeMetrics[] = [];

  private constructor() {}

  static getInstance(): MonitoringSystem {
    if (!MonitoringSystem.instance) {
      MonitoringSystem.instance = new MonitoringSystem();
    }
    return MonitoringSystem.instance;
  }

  trackAPIRequest(metric: APIMetrics): void {
    this.metrics.push(metric);
    const logData = {
      responseTime: metric.responseTime,
      statusCode: metric.statusCode,
      userId: metric.userId,
      error: metric.error
    };
  
    if (metric.statusCode >= 500) {
      logging.error(`API Failure: ${metric.endpoint}`, logData);
    } else if (metric.statusCode >= 400) {
      logging.warn(`API Warning: ${metric.endpoint}`, logData);
    } else {
      logging.info(`API Success: ${metric.endpoint}`, logData);
    }
  }

  trackChallengeGeneration(metric: ChallengeMetrics): void {
    this.challengeStats.push(metric);
    logging.debug('Challenge Generated', {
      challengeId: metric.challengeId,
      generationTime: metric.generationTime,
      difficulty: metric.difficulty,
      cacheStatus: metric.cacheStatus
    });
  }

  getPerformanceReport(): {
    apiMetrics: APIMetrics[];
    challengeMetrics: ChallengeMetrics[];
  } {
    return {
      apiMetrics: this.metrics,
      challengeMetrics: this.challengeStats
    };
  }

  async flushMetrics(): Promise<void> {
    // Send metrics to external monitoring service
  }
}

export const monitoring = MonitoringSystem.getInstance();