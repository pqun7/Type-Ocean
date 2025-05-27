// lib/redis.ts

// حماية من التنفيذ في المتصفح
if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Do not import redis client on the client side.");
}


import { createClient, RedisClientType } from 'redis';
import { logging } from '@/log/ServerLogger';

let client: RedisClientType;

try {
  client = createClient({
    username: 'default',
    password: process.env.REDIS_PASSWORD,
    socket: {
      host: 'redis-19697.c259.us-central1-2.gce.redns.redis-cloud.com',
      port: 19697,
    }
  });

  client.on('error', (err) => logging.error('Redis Client Error', err));
} catch (e) {
  // في بيئة الاختبار، يتم تجاهل تهيئة redis الفعلية
  if (process.env.NODE_ENV !== 'test') {
    throw e;
  }

  // mock بدائي في بيئة test فقط
  client = {
    connect: async () => {},
    hSet: async () => {},
    hGetAll: async () => ({}),
    exists: async () => 0,
    on: () => {},
  } as unknown as RedisClientType;
}

let isConnected = false;
let connectingPromise: Promise<void> | null = null;

export async function connectIfNeeded(): Promise<void> {
  if (isConnected) return;
  if (connectingPromise) return connectingPromise;

  connectingPromise = client.connect()
    .then(() => {
      isConnected = true;
      logging.info('Connected to Redis');
    })
    .catch((err) => {
      logging.error("Redis connection failed", err);
      throw err;
    });

  return connectingPromise;
}

export default client;
export { client as redis };
