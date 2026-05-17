import Redis from "ioredis";

export type BusMessage = {
  type: string;
  payload: unknown;
};

export type RedisBus = {
  enabled: true;
  publish: (channel: string, msg: BusMessage) => Promise<void>;
  subscribe: (channel: string) => Promise<void>;
  psubscribe: (pattern: string) => Promise<void>;
  unsubscribe: (channel: string) => Promise<void>;
  onMessage: (fn: (channel: string, msg: BusMessage) => void) => void;
  close: () => Promise<void>;
  redis: Redis;
};

export async function createRedisBus(redisUrl: string): Promise<RedisBus> {
  const pub = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  const sub = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  let lastConnectionError: unknown = null;
  const captureConnectionError = (error: unknown) => {
    lastConnectionError = error;
  };

  pub.on("error", captureConnectionError);
  sub.on("error", captureConnectionError);

  try {
    await Promise.all([pub.connect(), sub.connect()]);
    await Promise.all([pub.ping(), sub.ping()]);
  } catch (error) {
    await Promise.allSettled([pub.quit(), sub.quit()]);
    throw (lastConnectionError ?? error);
  }

  let handler: ((channel: string, msg: BusMessage) => void) | null = null;

  sub.on("message", (channel, message) => {
    if (!handler) return;
    try {
      const parsed = JSON.parse(message) as BusMessage;
      if (!parsed || typeof parsed.type !== "string") return;
      handler(channel, parsed);
    } catch {
      // ignore
    }
  });

  sub.on("pmessage", (_pattern, channel, message) => {
    if (!handler) return;
    try {
      const parsed = JSON.parse(message) as BusMessage;
      if (!parsed || typeof parsed.type !== "string") return;
      handler(channel, parsed);
    } catch {
      // ignore
    }
  });

  return {
    enabled: true,
    redis: pub,
    publish: async (channel, msg) => {
      await pub.publish(channel, JSON.stringify(msg));
    },
    subscribe: async (channel) => {
      await sub.subscribe(channel);
    },
    psubscribe: async (pattern) => {
      await sub.psubscribe(pattern);
    },
    unsubscribe: async (channel) => {
      await sub.unsubscribe(channel);
    },
    onMessage: (fn) => {
      handler = fn;
    },
    close: async () => {
      try {
        await sub.quit();
      } catch {
        // ignore
      }
      try {
        await pub.quit();
      } catch {
        // ignore
      }
    },
  };
}

export function userChannel(userId: string) {
  return `pvp:user:${userId}`;
}

export function matchChannel(matchId: string) {
  return `pvp:match:${matchId}`;
}

export function roomChannel(roomCode: string) {
  return `pvp:room:${roomCode}`;
}
