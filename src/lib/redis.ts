if (typeof window !== "undefined") {
  throw new Error("Do not import redis client on the client side.");
}

import { createClient, RedisClientType } from 'redis';
import { logging } from '@/log/ServerLogger';


const client: RedisClientType = createClient({
  username: 'default',
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: 'redis-19697.c259.us-central1-2.gce.redns.redis-cloud.com',
    port: 19697,
  }
});

client.on('error', (err) => logging.error('Redis Client Error', err));

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
