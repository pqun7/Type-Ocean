// src/lib/redis.ts
import "server-only";

import Redis, { RedisOptions } from 'ioredis'; // <--- Fix 1: import RedisOptions
import { logger } from '@/log/ServerLogger';
import { LUA_UPDATE_STATS_SCRIPT } from "@/constants/atomic"

// 3. (Important) Define the TypeScript interface
// Must be in the global scope or here to work
declare module "ioredis" {
  interface Redis {
    updateUserStats(
      key: string,
      wpm: string,
      accuracy: string,
      timeSpent: string,
      textLength: string,
      wordsTyped: string,
      timestamp: string,
      ttl: string,
      mistakes: string,
      corrections: string,
      consistency: string
    ): Promise<string[]>; // returns [key1, val1, key2, val2, ...]
  }
}

class RedisManager {
  private client: Redis;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;
  private lastConnErrorLogAt = 0;
  private lastConnErrorSignature = "";

  constructor() {
    const config = this.getRedisConfig();
    this.client = typeof config === "string" ? new Redis(config) : new Redis(config);

    this.setupEventHandlers();
    this.defineLuaCommands(); // <--- Fix 2: call LUA definition here
    this.attachShutdownHandlers();
  }

  private getRedisConfig(): RedisOptions | string { // allow REDIS_URL
    const isDevelopment = process.env.NODE_ENV === 'development';
    const wantsTls = process.env.REDIS_TLS === "true";

    // If a full URL is provided, prefer it in any environment.
    const canonicalRedisUrl = process.env.REDIS_URL || process.env.NEXT_REDIS_URL;
    if (canonicalRedisUrl) {
      return canonicalRedisUrl;
    }
    
    if (isDevelopment) {
      return {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        connectTimeout: 3000,
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: (times) => {
          // Prevent endless noisy reconnect loops in local dev.
          if (times > 10) return null;
          return Math.min(1000 * times, 10_000);
        },
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        enableReadyCheck: false,
      } as RedisOptions;
    }

    // Production config
    const baseConfig: RedisOptions = { // <--- Fix 1: use RedisOptions
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      connectTimeout: 10000,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(200 * 2 ** Math.min(times, 7), 30_000),
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    } as RedisOptions;

    // Enable TLS only when explicitly requested (or when using a rediss:// URL).
    // With REDIS_URL we return the URL string above, so TLS is handled by ioredis.
    if (wantsTls) {
      baseConfig.tls = {};
    }

    return baseConfig;
  }

  private getErrorSignature(err: unknown): string {
    if (err instanceof Error) return `${err.name}:${this.redactCredentials(err.message)}`;
    try {
      return typeof err === "string"
        ? this.redactCredentials(err)
        : this.redactCredentials(JSON.stringify(err));
    } catch {
      return String(err);
    }
  }

  /** Strip passwords from Redis URLs that may appear in error messages. */
  private redactCredentials(value: string): string {
    // Matches redis[s]://[user:]password@host — replaces password with ***
    return value.replace(/(rediss?:\/\/[^:@/]*:)[^@]+(@)/gi, "$1***$2");
  }

  private logConnectionErrorThrottled(err: unknown) {
    const now = Date.now();
    const signature = this.getErrorSignature(err);

    // Log at most once every 10s for the same repeating error.
    const isSame = signature === this.lastConnErrorSignature;
    const withinWindow = now - this.lastConnErrorLogAt < 10_000;
    if (isSame && withinWindow) return;

    this.lastConnErrorSignature = signature;
    this.lastConnErrorLogAt = now;

    // Log only the sanitized message — never the raw error object which may
    // contain the full connection URL including the password.
    logger.error('Redis connection error', { message: signature });
  }

  private setupEventHandlers() {
    // Avoid duplicate listeners if this module is re-evaluated (e.g. Next.js dev).
    if (this.client.listenerCount("error") === 0) {
      this.client.on('error', (err) => {
        this.logConnectionErrorThrottled(err);
      });
    }

    if (this.client.listenerCount("connect") === 0) {
      this.client.on('connect', () => {
        logger.debug('Redis connecting...');
      });
    }

    if (this.client.listenerCount("ready") === 0) {
      this.client.on('ready', () => {
        this.isConnected = true;
        logger.debug('Redis connected and ready');
      });
    }

    if (this.client.listenerCount("end") === 0) {
      this.client.on('end', () => {
        this.isConnected = false;
        logger.debug('Redis connection closed');
      });
    }
  }

  private attachShutdownHandlers() {
    if (typeof process === 'undefined' || !process.on) return;

    const globalForRedis = globalThis as typeof globalThis & {
      __redisShutdownHandlersAttached?: boolean;
    };
    if (globalForRedis.__redisShutdownHandlersAttached) return;
    globalForRedis.__redisShutdownHandlersAttached = true;

    const shutdown = async (signal?: string) => {
      try {
        logger.info('Process shutting down, disconnecting Redis', { signal });
        await this.disconnect();
      } catch (err: unknown) { // <--- Fix 3: use unknown
        logger.error('Error during Redis disconnect on shutdown', { 
          error: (err instanceof Error ? err.message : String(err)) 
        });
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT').then(() => process.exit(0)));
    process.on('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)));
    process.on('beforeExit', () => shutdown('beforeExit'));
  }

  async connectIfNeeded(): Promise<void> {
    if (this.isConnected || this.client.status === 'ready') return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = (async () => {
      try {
        if (this.client.status === 'wait' || this.client.status === 'end') {
          await this.client.connect();
          this.isConnected = true;
          logger.debug('Successfully connected to Redis');
          return;
        }

        // If ioredis is already trying to reconnect, don't spam connect() calls.
        if (this.client.status === 'connecting' || this.client.status === 'reconnecting' || this.client.status === 'connect') {
          await new Promise<void>((resolve, reject) => {
            const timeoutMs = process.env.NODE_ENV === "development" ? 2500 : 8000;
            const t = setTimeout(() => {
              cleanup();
              reject(new Error(`Redis not ready after ${timeoutMs}ms (status=${this.client.status})`));
            }, timeoutMs);

            const onReady = () => {
              cleanup();
              this.isConnected = true;
              resolve();
            };
            const onError = (err: Error) => {
              cleanup();
              reject(err);
            };
            const cleanup = () => {
              clearTimeout(t);
              this.client.off("ready", onReady);
              this.client.off("error", onError);
            };

            this.client.once("ready", onReady);
            this.client.once("error", onError);
          });
        }
      } catch (error: unknown) { // <--- Fix 3: use unknown
        this.isConnected = false;
        this.connectionPromise = null;
        logger.error('Failed to connect to Redis', error, { environment: process.env.NODE_ENV });
        
        if (process.env.NODE_ENV === 'development') {
          console.log('💡 Development troubleshooting:');
          console.log('1. Make sure Redis is installed: sudo apt install redis-server');
          console.log('2. Start Redis: sudo service redis-server start');
          console.log('3. Check status: sudo service redis-server status');
        }
        throw error;
      }
    })();

    return this.connectionPromise;
  }

  getClient(): Redis {
    return this.client;
  }

  async disconnect(): Promise<void> {
    // <--- Fix 4: use 'ready' and 'connect'
    if (this.client.status === 'ready' || this.client.status === 'connect') {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  // Helper method to check Redis health
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  // <--- Fix 2: LUA logic moved here
  private defineLuaCommands() {
    // Define the custom command
    this.client.defineCommand("updateUserStats", {
      numberOfKeys: 1, // KEYS[1]
      lua: LUA_UPDATE_STATS_SCRIPT,
    });
  }
}

// Singleton instance (safe for Next.js dev/hot reload)
const globalForRedis = globalThis as typeof globalThis & { __redisManager?: RedisManager };
export const redisManager = globalForRedis.__redisManager ?? new RedisManager();
if (process.env.NODE_ENV !== "production") {
  globalForRedis.__redisManager = redisManager;
}
export const redis = redisManager.getClient();
export const connectIfNeeded = () => redisManager.connectIfNeeded();

// Prevent client-side usage
if (typeof window !== 'undefined') {
  throw new Error('Redis client should not be used on the client side');
}
