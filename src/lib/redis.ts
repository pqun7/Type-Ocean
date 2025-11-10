// src/lib/redis.ts
import Redis, { RedisOptions } from 'ioredis'; // <--- Fix 1: import RedisOptions
import { logger } from '@/log/ServerLogger';

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
      ttl: string
    ): Promise<string[]>; // returns [key1, val1, key2, val2, ...]
  }
}

class RedisManager {
  private client: Redis;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    const config = this.getRedisConfig();
    this.client = new Redis(config);

    this.setupEventHandlers();
    this.defineLuaCommands(); // <--- Fix 2: call LUA definition here
    this.attachShutdownHandlers();
  }

  private getRedisConfig(): RedisOptions { // <--- Fix 1: use RedisOptions
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
      } as RedisOptions;
    }

    // Production config
    const baseConfig: RedisOptions = { // <--- Fix 1: use RedisOptions
      host: process.env.REDIS_HOST || 'redis-19697.c259.us-central1-2.gce.redns.redis-cloud.com',
      port: parseInt(process.env.REDIS_PORT || '19697'),
      password: process.env.REDIS_PASSWORD,
      connectTimeout: 10000,
      lazyConnect: true,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    } as RedisOptions;

    // Add TLS for production if there's no URL
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
        this.connectIfNeeded().catch((err: unknown) => { // <--- Fix 3: use unknown
          logger.error('Redis reconnect attempt failed', { 
            error: (err instanceof Error ? err.message : String(err)) 
          });
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
      } catch (err: unknown) { // <--- Fix 3: use unknown
        logger.error('Error during Redis disconnect on shutdown', { 
          error: (err instanceof Error ? err.message : String(err)) 
        });
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
      } catch (error: unknown) { // <--- Fix 3: use unknown
        this.isConnected = false;
        this.connectionPromise = null;
        const errorMessage = (error instanceof Error ? error.message : String(error));

        logger.error('Failed to connect to Redis', {
          error: errorMessage,
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
    const LUA_UPDATE_STATS_SCRIPT = `
    -- KEYS[1] = User stats key (e.g., user:longterm:USER_ID)
    -- ARGV[1] = New WPM (string)
    -- ARGV[2] = New Accuracy (string)
    -- ARGV[3] = TimeSpent (string)
    -- ARGV[4] = TextLength (string)
    -- ARGV[5] = WordsTyped (calculated in Node.js) (string)
    -- ARGV[6] = Current timestamp (ISO string)
    -- ARGV[7] = TTL (seconds) (string)

    local stats = redis.call('HGETALL', KEYS[1])
    local current = {}
    local newStatsPayload = {}

    for i = 1, #stats, 2 do
      current[stats[i]] = stats[i+1]
    end

    local newWPM = tonumber(ARGV[1])
    local newAcc = tonumber(ARGV[2])
    local timeSpent = tonumber(ARGV[3])
    local textLength = tonumber(ARGV[4])
    local wordsTyped = tonumber(ARGV[5])

    local totalSessions
    if #stats == 0 then
      -- ===== New user =====
      totalSessions = 1
      newStatsPayload = {
        "totalSessions", "1",
        "totalTimeTyped", ARGV[3],
        "totalWordsTyped", ARGV[5],
        "totalCharactersTyped", ARGV[4],
        "averageWPM", ARGV[1],
        "averageAccuracy", ARGV[2],
        "bestWPM", ARGV[1],
        "bestWPMDate", ARGV[6],
        "bestAccuracy", ARGV[2],
        "bestAccuracyDate", ARGV[6],
        "lastUpdated", ARGV[6]
      }
    else
      -- ===== Existing user =====
      local currentTotalSessions = tonumber(current.totalSessions) or 0
      totalSessions = currentTotalSessions + 1
      
      local currentAvgWPM = tonumber(current.averageWPM) or 0
      local currentAvgAcc = tonumber(current.averageAccuracy) or 0
      local currentBestWPM = tonumber(current.bestWPM) or 0
      local currentBestAcc = tonumber(current.bestAccuracy) or 0

      -- Calculate new averages
      local newAvgWPM = (currentAvgWPM * (totalSessions - 1) + newWPM) / totalSessions
      local newAvgAcc = (currentAvgAcc * (totalSessions - 1) + newAcc) / totalSessions

      newStatsPayload = {
        "totalSessions", tostring(totalSessions),
        "totalTimeTyped", tostring((tonumber(current.totalTimeTyped) or 0) + timeSpent),
        "totalWordsTyped", tostring((tonumber(current.totalWordsTyped) or 0) + wordsTyped),
        "totalCharactersTyped", tostring((tonumber(current.totalCharactersTyped) or 0) + textLength),
        "averageWPM", tostring(math.floor(newAvgWPM * 100 + 0.5) / 100),
        "averageAccuracy", tostring(math.floor(newAvgAcc * 100 + 0.5) / 100),
        "lastUpdated", ARGV[6]
      }

      -- Update best values
      if newWPM > currentBestWPM then
        table.insert(newStatsPayload, "bestWPM")
        table.insert(newStatsPayload, ARGV[1])
        table.insert(newStatsPayload, "bestWPMDate")
        table.insert(newStatsPayload, ARGV[6])
      end
      
      if newAcc > currentBestAcc then
        table.insert(newStatsPayload, "bestAccuracy")
        table.insert(newStatsPayload, ARGV[2])
        table.insert(newStatsPayload, "bestAccuracyDate")
        table.insert(newStatsPayload, ARGV[6])
      end
    end

    redis.call('HSET', KEYS[1], unpack(newStatsPayload))
    redis.call('EXPIRE', KEYS[1], ARGV[7])

    -- Return the updated data
    return redis.call('HGETALL', KEYS[1])
    `;

    // Define the custom command
    this.client.defineCommand("updateUserStats", {
      numberOfKeys: 1, // KEYS[1]
      lua: LUA_UPDATE_STATS_SCRIPT,
    });
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
