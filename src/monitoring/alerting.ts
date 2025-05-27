// src/monitoring/alerting.ts
import { logging } from "@/log/ServerLogger";
interface APIMetrics {
  statusCode: number;
  responseTime: number;
}

interface AlertRule {
    condition: (metrics: APIMetrics[]) => boolean;
    message: string;
    severity: 'critical' | 'warning';
  }
  
  export class AlertManager {
    private rules: AlertRule[] = [
      {
        condition: metrics => metrics.filter(m => m.statusCode >= 500).length > 5,
        message: 'High error rate detected!',
        severity: 'critical'
      },
      {
        condition: metrics => 
          metrics.filter(m => m.responseTime > 2000).length > 10,
        message: 'Slow response times detected',
        severity: 'warning'
      }
    ];
  
    checkAlerts(metrics: APIMetrics[]): void {
      this.rules.forEach(rule => {
        if (rule.condition(metrics)) {
          logging[rule.severity === 'critical' ? 'error' : 'warn'](rule.message, {
            alertType: 'performance',
            triggerTime: new Date().toISOString()
          });
        }
      });
    }
  }