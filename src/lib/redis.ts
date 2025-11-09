// src/lib/redis.ts
import Redis from 'ioredis';
import { logger } from '@/log/ServerLogger';

class RedisManager {
  private client: Redis;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    const config = this.getRedisConfig();
    this.client = new Redis(config);

    this.setupEventHandlers();
    this.attachShutdownHandlers();
  }

  private getRedisConfig(): Redis.RedisOptions {
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    if (isDevelopment) {
      return {
        host: '127.0.0.1',
        port: 6379,
        connectTimeout: 3000,
        lazyConnect: true,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        enableReadyCheck: false,
      };
    }

    // Production config
    const baseConfig: Redis.RedisOptions = {
      host: process.env.REDIS_HOST || 'redis-19697.c259.us-central1-2.gce.redns.redis-cloud.com',
      port: parseInt(process.env.REDIS_PORT || '19697'),
      password: process.env.REDIS_PASSWORD,
      connectTimeout: 10000,
      lazyConnect: true,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    };

    // إضافة TLS للإنتاج إذا لم يكن هناك URL
    if (!process.env.REDIS_URL) {
      baseConfig.tls = {};
    }

    return baseConfig;
  }

  private setupEventHandlers() {
    this.client.on('error', (err) => {
      logger.error('Redis connection error', { error: err.message });
    });

    this.client.on('connect', () => {
      logger.debug('Redis connecting...');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      logger.debug('Redis connected and ready');
    });

    this.client.on('end', () => {
      this.isConnected = false;
      logger.debug('Redis connection closed');
    });
  }

  private attachReconnectStrategy() {
    this.client.on('end', () => {
      logger.warn('Redis disconnected, retrying in 3s...');
      setTimeout(() => {
        this.connectIfNeeded().catch((err) => {
          logger.error('Redis reconnect attempt failed', { error: err.message });
        });
      }, 3000);
    });
  }

  private attachShutdownHandlers() {
    if (typeof process === 'undefined' || !process.on) return;

    const shutdown = async (signal?: string) => {
      try {
        logger.info('Process shutting down, disconnecting Redis', { signal });
        await this.disconnect();
      } catch (err: any) {
        logger.error('Error during Redis disconnect on shutdown', { error: err.message });
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT').then(() => process.exit(0)));
    process.on('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)));
    process.on('beforeExit', () => shutdown('beforeExit'));

    this.attachReconnectStrategy();
  }

  async connectIfNeeded(): Promise<void> {
    if (this.isConnected) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = (async () => {
      try {
        if (this.client.status === 'wait' || this.client.status === 'end') {
          await this.client.connect();
          this.isConnected = true;
          logger.debug('Successfully connected to Redis');
        }
      } catch (error: any) {
        this.isConnected = false;
        this.connectionPromise = null;

        logger.error('Failed to connect to Redis', {
          error: error.message,
          environment: process.env.NODE_ENV,
        });
        
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
    if (this.client.status === 'connected' || this.client.status === 'connecting') {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  // دالة مساعدة للتحقق من الاتصال
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const redisManager = new RedisManager();
export const redis = redisManager.getClient();
export const connectIfNeeded = () => redisManager.connectIfNeeded();

// Prevent client-side usage
if (typeof window !== 'undefined') {
  throw new Error('Redis client should not be used on the client side');
}