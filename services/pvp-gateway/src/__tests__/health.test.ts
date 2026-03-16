import { createGatewayHealthController } from "../health";

describe("createGatewayHealthController", () => {
  it("reports ready when dependencies are healthy", async () => {
    const controller = createGatewayHealthController({
      instanceId: "gateway-test",
      prisma: {
        execute: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
      },
      getRedisClient: () => ({
        ping: jest.fn().mockResolvedValue("PONG"),
      }),
      getConnectionCount: () => 12,
      getActiveMatchCount: () => 3,
      wsSoftConnectionLimit: 100,
      redisRequired: true,
    });

    const response = await controller.evaluate("ready");

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.ready).toBe(true);
    expect(response.body.acceptingTraffic).toBe(true);
    expect(response.body.dependencies).toEqual({ prisma: true, redis: true });
  });

  it("reports not ready while draining", async () => {
    const controller = createGatewayHealthController({
      instanceId: "gateway-test",
      prisma: {
        execute: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
      },
      getRedisClient: () => null,
      getConnectionCount: () => 0,
      getActiveMatchCount: () => 1,
      wsSoftConnectionLimit: 100,
      redisRequired: false,
    });

    controller.beginDraining();
    const response = await controller.evaluate("ready");

    expect(response.statusCode).toBe(503);
    expect(response.body.status).toBe("not_ready");
    expect(response.body.draining).toBe(true);
    expect(response.body.ready).toBe(false);
    expect(response.body.shutdownStartedAt).not.toBeNull();
  });

  it("reports degraded health when overloaded", async () => {
    const controller = createGatewayHealthController({
      instanceId: "gateway-test",
      prisma: {
        execute: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
      },
      getRedisClient: () => null,
      getConnectionCount: () => 20,
      getActiveMatchCount: () => 4,
      wsSoftConnectionLimit: 20,
      redisRequired: false,
    });

    const response = await controller.evaluate("health");

    expect(response.statusCode).toBe(503);
    expect(response.body.status).toBe("degraded");
    expect(response.body.overloaded).toBe(true);
    expect(response.body.acceptingTraffic).toBe(false);
  });
});