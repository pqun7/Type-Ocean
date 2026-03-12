type PrismaProbeClient = {
  $queryRawUnsafe(query: string): Promise<unknown>;
};

type RedisProbeClient = {
  ping(): Promise<string>;
};

type GatewayHealthControllerOptions = {
  instanceId: string;
  prisma: PrismaProbeClient;
  getRedisClient: () => RedisProbeClient | null;
  getConnectionCount: () => number;
  getActiveMatchCount: () => number;
  wsSoftConnectionLimit: number;
  redisRequired: boolean;
};

export type GatewayHealthReport = {
  status: "ok" | "degraded" | "not_ready";
  instanceId: string;
  ready: boolean;
  draining: boolean;
  acceptingTraffic: boolean;
  activeConnections: number;
  activeMatches: number;
  overloaded: boolean;
  dependencies: {
    prisma: boolean;
    redis: boolean;
  };
  checkedAt: string;
  shutdownStartedAt: string | null;
};

async function checkPrisma(prisma: PrismaProbeClient) {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(redis: RedisProbeClient | null, redisRequired: boolean) {
  if (!redis) return !redisRequired;

  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

export function createGatewayHealthController(options: GatewayHealthControllerOptions) {
  const state = {
    ready: true,
    draining: false,
    shutdownStartedAtMs: null as number | null,
  };

  function getSnapshot() {
    const activeConnections = options.getConnectionCount();
    const activeMatches = options.getActiveMatchCount();
    const overloaded = activeConnections >= options.wsSoftConnectionLimit;

    return {
      activeConnections,
      activeMatches,
      overloaded,
      acceptingTraffic: state.ready && !state.draining && !overloaded,
    };
  }

  return {
    isReady() {
      return state.ready;
    },
    isDraining() {
      return state.draining;
    },
    canAcceptTraffic() {
      return getSnapshot().acceptingTraffic;
    },
    beginDraining() {
      if (state.shutdownStartedAtMs == null) {
        state.shutdownStartedAtMs = Date.now();
      }
      state.draining = true;
      state.ready = false;
    },
    markReady() {
      state.ready = true;
      state.draining = false;
      state.shutdownStartedAtMs = null;
    },
    async evaluate(kind: "health" | "ready"): Promise<{ statusCode: number; body: GatewayHealthReport }> {
      const [prismaHealthy, redisHealthy] = await Promise.all([
        checkPrisma(options.prisma),
        checkRedis(options.getRedisClient(), options.redisRequired),
      ]);

      const snapshot = getSnapshot();
      const dependencyHealthy = prismaHealthy && redisHealthy;
      const ready = dependencyHealthy && !snapshot.overloaded && state.ready && !state.draining;
      const live = dependencyHealthy && !snapshot.overloaded;

      const body: GatewayHealthReport = {
        status: kind === "ready" ? (ready ? "ok" : "not_ready") : live ? "ok" : "degraded",
        instanceId: options.instanceId,
        ready,
        draining: state.draining,
        acceptingTraffic: snapshot.acceptingTraffic,
        activeConnections: snapshot.activeConnections,
        activeMatches: snapshot.activeMatches,
        overloaded: snapshot.overloaded,
        dependencies: {
          prisma: prismaHealthy,
          redis: redisHealthy,
        },
        checkedAt: new Date().toISOString(),
        shutdownStartedAt: state.shutdownStartedAtMs == null ? null : new Date(state.shutdownStartedAtMs).toISOString(),
      };

      return {
        statusCode: kind === "ready" ? (ready ? 200 : 503) : live ? 200 : 503,
        body,
      };
    },
  };
}

export type GatewayHealthController = ReturnType<typeof createGatewayHealthController>;