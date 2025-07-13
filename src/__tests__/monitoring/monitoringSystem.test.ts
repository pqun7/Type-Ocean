/**
 * Comprehensive tests for monitoring system functionality
 */

import { 
  monitoringSystem,
  trackUserAction,
  trackApiCall,
  trackError,
  generateReport 
} from "@/monitoring/monitoringSystem";
import { alertingSystem } from "@/monitoring/alerting";
import { kpiTracker } from "@/monitoring/kpis";

// Mock dependencies
jest.mock("@/monitoring/alerting");
jest.mock("@/monitoring/kpis");
jest.mock("@/log/ServerLogger");

const mockAlertingSystem = alertingSystem as jest.Mocked<typeof alertingSystem>;
const mockKpiTracker = kpiTracker as jest.Mocked<typeof kpiTracker>;

describe("Monitoring System", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset monitoring system state
    monitoringSystem.metrics.clear();
  });

  describe("trackUserAction", () => {
    it("should track user login action", async () => {
      const actionData = {
        userId: "user-123",
        action: "login",
        metadata: { ip: "192.168.1.1", userAgent: "Chrome" }
      };

      await trackUserAction(actionData);

      expect(mockKpiTracker.incrementUserAction).toHaveBeenCalledWith("login");
      expect(monitoringSystem.metrics.has("user_action_login")).toBe(true);
    });

    it("should track typing session completion", async () => {
      const actionData = {
        userId: "user-123",
        action: "typing_session_complete",
        metadata: { wpm: 75, accuracy: 95, duration: 300 }
      };

      await trackUserAction(actionData);

      expect(mockKpiTracker.recordSessionStats).toHaveBeenCalledWith({
        wpm: 75,
        accuracy: 95,
        duration: 300
      });
    });

    it("should handle missing user ID gracefully", async () => {
      const actionData = {
        userId: "",
        action: "anonymous_action",
        metadata: {}
      };

      await expect(trackUserAction(actionData)).resolves.not.toThrow();
    });
  });

  describe("trackApiCall", () => {
    it("should track successful API call", async () => {
      const apiData = {
        endpoint: "/api/users/v1",
        method: "GET",
        statusCode: 200,
        responseTime: 150,
        userId: "user-123"
      };

      await trackApiCall(apiData);

      expect(mockKpiTracker.recordApiCall).toHaveBeenCalledWith(apiData);
      expect(monitoringSystem.metrics.get("api_call_success")).toBeDefined();
    });

    it("should track failed API call and trigger alert", async () => {
      const apiData = {
        endpoint: "/api/users/v1",
        method: "POST",
        statusCode: 500,
        responseTime: 5000,
        userId: "user-123",
        error: "Database connection failed"
      };

      await trackApiCall(apiData);

      expect(mockKpiTracker.recordApiCall).toHaveBeenCalledWith(apiData);
      expect(mockAlertingSystem.checkThresholds).toHaveBeenCalled();
    });

    it("should track slow API calls", async () => {
      const slowApiData = {
        endpoint: "/api/challenge/v1/daily",
        method: "GET",
        statusCode: 200,
        responseTime: 3000, // 3 seconds
        userId: "user-123"
      };

      await trackApiCall(slowApiData);

      expect(mockAlertingSystem.triggerSlowResponseAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "/api/challenge/v1/daily",
          responseTime: 3000
        })
      );
    });
  });

  describe("trackError", () => {
    it("should track application error", async () => {
      const error = new Error("Database connection timeout");
      const context = {
        userId: "user-123",
        endpoint: "/api/session-stats/v1",
        requestId: "req-456"
      };

      await trackError(error, context);

      expect(mockKpiTracker.incrementErrorCount).toHaveBeenCalledWith(
        "Database connection timeout"
      );
      expect(mockAlertingSystem.checkErrorThreshold).toHaveBeenCalled();
    });

    it("should categorize errors by type", async () => {
      const validationError = new Error("Invalid email format");
      validationError.name = "ValidationError";

      await trackError(validationError, { userId: "user-123" });

      expect(mockKpiTracker.incrementErrorCount).toHaveBeenCalledWith(
        "ValidationError"
      );
    });

    it("should handle critical errors with immediate alerts", async () => {
      const criticalError = new Error("Redis connection lost");
      const context = {
        severity: "critical",
        userId: "user-123"
      };

      await trackError(criticalError, context);

      expect(mockAlertingSystem.triggerCriticalAlert).toHaveBeenCalledWith({
        error: criticalError,
        context
      });
    });
  });

  describe("generateReport", () => {
    beforeEach(() => {
      // Set up mock metrics data
      monitoringSystem.metrics.set("user_action_login", 150);
      monitoringSystem.metrics.set("user_action_logout", 145);
      monitoringSystem.metrics.set("api_call_success", 1200);
      monitoringSystem.metrics.set("api_call_error", 25);
      monitoringSystem.metrics.set("error_count", 10);
    });

    it("should generate daily report", async () => {
      const report = await generateReport("daily");

      expect(report).toHaveProperty("period", "daily");
      expect(report).toHaveProperty("metrics");
      expect(report).toHaveProperty("summary");
      expect(report.metrics.totalUsers).toBe(150);
      expect(report.metrics.apiSuccessRate).toBeCloseTo(97.96, 2);
    });

    it("should generate weekly report with trends", async () => {
      mockKpiTracker.getWeeklyTrends.mockResolvedValue({
        userGrowth: 12.5,
        averageWpm: 68.3,
        sessionCount: 2840
      });

      const report = await generateReport("weekly");

      expect(report).toHaveProperty("trends");
      expect(report.trends.userGrowth).toBe(12.5);
      expect(mockKpiTracker.getWeeklyTrends).toHaveBeenCalled();
    });

    it("should include performance metrics in report", async () => {
      const report = await generateReport("daily");

      expect(report.performance).toHaveProperty("averageResponseTime");
      expect(report.performance).toHaveProperty("errorRate");
      expect(report.performance).toHaveProperty("uptime");
    });
  });

  describe("Real-time Monitoring", () => {
    it("should track concurrent users", async () => {
      await trackUserAction({
        userId: "user-1",
        action: "session_start",
        metadata: {}
      });

      await trackUserAction({
        userId: "user-2",
        action: "session_start",
        metadata: {}
      });

      await trackUserAction({
        userId: "user-1",
        action: "session_end",
        metadata: {}
      });

      const concurrentUsers = monitoringSystem.getConcurrentUsers();
      expect(concurrentUsers).toBe(1);
    });

    it("should monitor system health", async () => {
      const healthCheck = await monitoringSystem.getSystemHealth();

      expect(healthCheck).toHaveProperty("status");
      expect(healthCheck).toHaveProperty("uptime");
      expect(healthCheck).toHaveProperty("memoryUsage");
      expect(healthCheck).toHaveProperty("activeConnections");
    });

    it("should detect anomalies in traffic patterns", async () => {
      // Simulate high traffic
      for (let i = 0; i < 1000; i++) {
        await trackApiCall({
          endpoint: "/api/challenge/v1/daily",
          method: "GET",
          statusCode: 200,
          responseTime: 100,
          userId: `user-${i}`
        });
      }

      expect(mockAlertingSystem.checkTrafficAnomaly).toHaveBeenCalled();
    });
  });

  describe("Data Retention", () => {
    it("should clean up old metrics data", async () => {
      await monitoringSystem.cleanupOldData(30); // Keep 30 days

      expect(mockKpiTracker.cleanupOldData).toHaveBeenCalledWith(30);
    });

    it("should archive historical reports", async () => {
      await monitoringSystem.archiveReports("2024");

      expect(mockKpiTracker.archiveData).toHaveBeenCalledWith("2024");
    });
  });

  describe("Performance Optimization", () => {
    it("should batch metric updates for performance", async () => {
      const actions = Array.from({ length: 100 }, (_, i) => ({
        userId: `user-${i}`,
        action: "typing_test_start",
        metadata: {}
      }));

      await Promise.all(actions.map(trackUserAction));

      // Verify batching occurred
      expect(mockKpiTracker.batchUpdate).toHaveBeenCalled();
    });

    it("should handle high-frequency events efficiently", async () => {
      const startTime = Date.now();

      // Simulate rapid API calls
      const promises = Array.from({ length: 1000 }, () =>
        trackApiCall({
          endpoint: "/api/session-stats/v1",
          method: "POST",
          statusCode: 200,
          responseTime: 50,
          userId: "user-123"
        })
      );

      await Promise.all(promises);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should complete within reasonable time (less than 1 second)
      expect(totalTime).toBeLessThan(1000);
    });
  });
});