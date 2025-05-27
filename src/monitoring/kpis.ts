import { logging } from "@/log/ServerLogger";

interface APIMetrics {
    endpoint: string;
    responseTime: number;
    statusCode: number;
    userId?: string;
    error?: string;
  }
  
export class PerformanceAnalyzer {
    static calculateStats(metrics: APIMetrics[]) {
      return {
        avgResponseTime: 
          metrics.reduce((sum, m) => sum + m.responseTime, 0) / metrics.length,
        successRate: 
          metrics.filter(m => m.statusCode < 400).length / metrics.length,
        topErrors: this.getTopErrors(metrics)
      };
    }

    static logPerformanceTrends(metrics: APIMetrics[]): void {
      const stats = this.calculateStats(metrics);
      
      logging.info('Performance Trends', {
        avgResponse: stats.avgResponseTime,
        successRate: stats.successRate,
        topErrors: stats.topErrors.slice(0, 3)
      });
    }
  
    private static getTopErrors(metrics: APIMetrics[]) {
      const errorCounts: Record<string, number> = {};
      metrics.forEach(m => {
        if (m.error) errorCounts[m.error] = (errorCounts[m.error] || 0) + 1;
      });
      return Object.entries(errorCounts).sort((a, b) => b[1] - a[1]);
    }
  }