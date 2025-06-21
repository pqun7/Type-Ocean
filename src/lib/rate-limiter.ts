// src/lib/rateLimiter.ts
import Redis from "ioredis";
import { logger } from "@/log/ServerLogger";
import { 
  logRequestStart, 
  logRequestSuccess, 
  logRequestError,
} from "@/log/loggingUtils"; // استيراد الأدوات الجديدة
import { NextRequest, NextResponse } from "next/server";
import redis, { connectIfNeeded } from "@/lib/redis";

const LOG_FILE = "src/lib/rateLimiter.ts";

// 1. نوع البيانات للتهيئة
type RateLimitConfig = {
  limit: number;
  windowMs: number;
  strategy?: "token-bucket" | "fixed-window" | "sliding-window";
  burstAllowed?: boolean;
};

// 1.5. إعدادات نقاط النهاية الخاصة
const ENDPOINT_CONFIGS: Record<string, RateLimitConfig> = {
  "/api/session-stats/v1": {
    limit: 5,
    windowMs: 60_000,
    strategy: "sliding-window",
  },
  "/api/auth/login": {
    limit: 3,
    windowMs: 15_000,
    strategy: "fixed-window",
  },
  // إضافة نقاط النهاية الجديدة
  "/api/auth/resend-verification": {
    limit: 2,
    windowMs: 60_000,
    strategy: "fixed-window",
  },
  "/api/auth/reset-password": {
    limit: 3,
    windowMs: 30_000,
    strategy: "sliding-window",
  },
};

type RateLimitOptions = {
  namespace?: string;
  redisClient?: Redis;
  fallback?: "allow" | "deny";
};

// 2. تهيئة افتراضية آمنة
const DEFAULT_CONFIG: RateLimitConfig = {
  limit: 100,
  windowMs: 60 * 1000, // 1 دقيقة
  strategy: "token-bucket",
  burstAllowed: false,
};

const DEFAULT_OPTIONS: RateLimitOptions = {
  namespace: "rate-limit",
  fallback: "allow",
};

// 3. فئة رئيسية لإدارة Rate Limiting
export class RateLimiter {
  private redis: Redis;
  private configs: Map<string, RateLimitConfig>;
  private options: RateLimitOptions;
  private localCache = new Map<string, { count: number; expires: number }>();
  private async ensureRedisConnection(): Promise<void> {
    if (this.redis.status !== "ready") {
      await new Promise((resolve) => this.redis.once("connect", resolve));
    }
  }

  constructor(
    configs: Record<string, RateLimitConfig> = {},
    options: RateLimitOptions = {}
  ) {
    this.redis = options.redisClient || new Redis(process.env.REDIS_URL!);
    this.configs = new Map(Object.entries(configs));
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.redis.on("error", (err) => {
      logger.error("Redis connection error", err);
    });
  }

  // 4. تطبيق Rate Limit الأساسي
  async applyRateLimit(
    identifier: string,
    endpoint: string
  ): Promise<{ allowed: boolean; headers: Record<string, string> }> {
    const logType = "RATE_LIMIT";
    
    logRequestStart(identifier, logType, "RATE_LIMIT", LOG_FILE);

    await this.ensureRedisConnection();

    if (!identifier || !endpoint) {
      const isAllowed = this.options.fallback === "allow";

      logRequestSuccess(identifier, logType, "RATE_LIMIT", { 
        allowed: isAllowed,
        reason: "missing_identifier_or_endpoint"
      }, LOG_FILE);
      
      return {
        allowed: isAllowed,
        headers: {},
      };
    }

    try {
      const localKey = `${identifier}:${endpoint}`;
      const cached = this.localCache.get(localKey);
      const config = this.getConfig(endpoint);
     
      if (!config) {
        logger.warn("No rate limit config found for endpoint", { endpoint });
        return {
          allowed: this.options.fallback === "allow",
          headers: {},
        };
      }

      const key = await this.generateKey(identifier, endpoint);

      if (cached && cached.expires > Date.now()) {
        if (cached.count >= config.limit) {
          return {
            allowed: false,
            headers: this.generateHeaders(false, config),
          };
        }
        cached.count++;
        return { allowed: true, headers: this.generateHeaders(true, config) };
      }

      let result: boolean;
      switch (config.strategy) {
        case "token-bucket":
          result = await this.tokenBucket(key, config);
          break;
        case "sliding-window":
          result = await this.slidingWindow(key, config);
          break;
        default:
          result = await this.fixedWindow(key, config);
      }

      this.localCache.set(localKey, {
        count: result ? 1 : config.limit,
        expires: Date.now() + config.windowMs,
      });

      return {
        allowed: result,
        headers: this.generateHeaders(result, config),
      };
    } catch (error: any) {
      logRequestError(identifier, logType, error, { 
        endpoint, 
        errorDetails: error.message 
      }, LOG_FILE);
      // إضافة تأخير لإعطاء Redis فرصة لإعادة الاتصال
      if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      return {
        allowed: this.options.fallback === "allow",
        headers: {},
      };
    }
  }

  // 5. Token Bucket Algorithm
  private async tokenBucket(
    key: string,
    config: RateLimitConfig
  ): Promise<boolean> {
    const now = Date.now();
    const pipeline = this.redis.pipeline();

    // احصل على الحالة الحالية
    pipeline.hgetall(key);

    const results = await pipeline.exec();
    const data = results![0][1] as { tokens?: string; last?: string };

    let tokens = parseFloat(data?.tokens || config.limit.toString());
    const lastTime = data?.last ? parseInt(data.last) : now;

    // حساب التوكنز الجديدة
    const elapsed = now - lastTime;
    const refill = (elapsed * config.limit) / config.windowMs;
    tokens = Math.min(tokens + refill, config.limit);

    // التحقق من التوكنز المتاحة
    if (tokens < 1) return false;

    // خصم التوكن وتحديث القيم
    tokens -= 1;

    await this.redis
      .multi()
      .hset(key, "tokens", tokens.toString())
      .hset(key, "last", now.toString())
      .pexpire(key, config.windowMs)
      .exec();

    return true;
  }

  // 6. Sliding Window Algorithm
  private async slidingWindow(
    key: string,
    config: RateLimitConfig
  ): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const transaction = this.redis.multi();

    // إزالة الطلبات القديمة
    transaction.zremrangebyscore(key, 0, windowStart);

    // عد الطلبات المتبقية
    transaction.zcard(key);

    // إضافة الطلب الحالي
    transaction.zadd(key, now, `${now}-${crypto.randomUUID()}`);
    transaction.expire(key, Math.ceil(config.windowMs / 1000));

    const results = await transaction.exec();
    const count = results![1][1] as number;

    return count <= config.limit;
  }

  // 6.5. Fixed Window Algorithm
  private async fixedWindow(
    key: string,
    config: RateLimitConfig
  ): Promise<boolean> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, Math.ceil(config.windowMs / 1000));
    }
    return count <= config.limit;
  }

  // 7. توليد المفاتيح الآمنة
  private async generateKey(
    identifier: string,
    endpoint: string
  ): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(identifier);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const safeIdentifier = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `${this.options.namespace}:${safeIdentifier}:${endpoint}`;
  }

  // 8. توليد رؤوس الاستجابة
  private generateHeaders(
    allowed: boolean,
    config: RateLimitConfig
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "X-RateLimit-Limit": config.limit.toString(),
      "X-RateLimit-Remaining": allowed ? (config.limit - 1).toString() : "0",
      "X-RateLimit-Reset": (Date.now() + config.windowMs).toString(),
    };
    if (!allowed) {
      headers["Retry-After"] = (config.windowMs / 1000).toString();
    }
    return headers;
  }

  // 9. الحصول على التهيئة مع القيم الافتراضية
  private getConfig(endpoint: string): RateLimitConfig {
    return {
      ...DEFAULT_CONFIG,
      ...(this.configs.get(endpoint) || {}),
    };
  }

  // 10. تنظيف البيانات القديمة (للاستخدام في cron jobs)
  async cleanOldEntries(): Promise<void> {
    const keys = await this.redis.keys(`${this.options.namespace}:*`);
    const pipeline = this.redis.pipeline();

    keys.forEach((key) => {
      pipeline.pexpiretime(key);
    });

    const results = (await pipeline.exec()) as Array<[Error | null, number]>;

    results?.forEach(([err, ttl], index) => {
      if (ttl === -1 || ttl < 0) {
        this.redis.del(keys[index]);
      }
    });
  }
}

// 11. تهيئة افتراضية للاستخدام العام
export const rateLimiter = new RateLimiter(
  {
    // مثال لتهيئات خاصة بالنقاط الطرفية
    "session-stats": {
      limit: 50,
      windowMs: 60_000,
      strategy: "sliding-window",
    },
    auth: {
      limit: 20,
      windowMs: 15_000,
      strategy: "token-bucket",
    },
  },
  {
    redisClient: new Redis(process.env.REDIS_URL!, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    }),
    fallback: "allow",
  }
);

const generateKey = async (
  identifier: string,
  endpoint: string
): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(identifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `rate-limit:${hash}:${endpoint}`;
};

// 12. دمج مع إطار العمل (Next.js مثال)
export async function applyRateLimit(req: NextRequest, endpoint: string) {
  await connectIfNeeded();

  // الحصول على المعرف الفريد للعميل
  const identifier =
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "anonymous";

  // الحصول على التهيئة الخاصة بالنقطة الطرفية
  const config = ENDPOINT_CONFIGS[endpoint] || {
    limit: 100,
    windowMs: 60_000,
    strategy: "sliding-window",
  };

  const redisKey = await generateKey(identifier, endpoint);
  const now = Date.now();

  try {
    // 5. تطبيق خوارزمية Sliding Window
    if (config.strategy === "sliding-window") {
      const pipeline = redis.multi();

      // إزالة الطلبات الأقدم من النافذة الزمنية
      pipeline.zRemRangeByScore(redisKey, 0, now - config.windowMs);

      // الحصول على عدد الطلبات الحالي
      pipeline.zCard(redisKey);

      // إضافة الطلب الحالي
      pipeline.zAdd(redisKey, [
        { score: now, value: `${now}-${Math.random()}` },
      ]);

      // تحديث مدة الانتهاء
      pipeline.expire(redisKey, Math.ceil(config.windowMs / 1000));

      const results = await pipeline.exec();

      let count = 0;
      if (
        Array.isArray(results) &&
        Array.isArray(results[1]) &&
        typeof results[1][1] === "number"
      ) {
        count = results[1][1];
      }

      if (count > config.limit) {
        logger.warn("Rate limit exceeded", { identifier, endpoint, count });
        return {
          allowed: false,
          headers: {
            "X-RateLimit-Limit": config.limit.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": (now + config.windowMs).toString(),
            "Retry-After": (config.windowMs / 1000).toString(),
          },
        };
      }
    }

    // 6. تطبيق خوارزمية Fixed Window
    else {
      const currentWindow = Math.floor(now / config.windowMs);
      const key = `${redisKey}:${currentWindow}`;

      const count = await redis.incr(key);
      await redis.expire(key, Math.ceil(config.windowMs / 1000));

      if (count > config.limit) {
        logger.warn("Rate limit exceeded", { identifier, endpoint, count });
        return {
          allowed: false,
          headers: {
            "X-RateLimit-Limit": config.limit.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": (
              (currentWindow + 1) *
              config.windowMs
            ).toString(),
            "Retry-After": (config.windowMs / 1000).toString(),
          },
        };
      }
    }

    // 7. إرجاع النتيجة المسموح بها
    return {
      allowed: true,
      headers: {
        "X-RateLimit-Limit": config.limit.toString(),
        "X-RateLimit-Remaining": (config.limit - 1).toString(),
        "X-RateLimit-Reset": (now + config.windowMs).toString(),
      },
    };
  } catch (error) {
    logger.error("Rate limiter failure", error, { identifier, endpoint });
    // Fallback strategy: allow request in case of Redis failure
    return {
      allowed: true,
      headers: {},
    };
  }
}

// 8. دالة مساعدة للاستخدام في API Routes
export async function enforceRateLimit(req: NextRequest, endpoint: string) {
  const { allowed, headers } = await applyRateLimit(req, endpoint);

  

  const stringHeaders: Record<string, string> = Object.fromEntries(
    Object.entries(headers).filter(([, value]) => typeof value === "string")
  );

  if (!allowed) {
    return new NextResponse(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: new Headers(stringHeaders),
    });
  }

  return new Headers(stringHeaders);
}

export async function checkRateLimit(endpoint: string, identifier: string) {
  const rateLimiter = new RateLimiter(ENDPOINT_CONFIGS, {
    redisClient: new Redis(process.env.REDIS_URL!, {
      retryStrategy: (times) => {
        return Math.min(times * 100, 3000); // إعادة الاتصال بعد 100ms، 200ms، 300ms
      },
      maxRetriesPerRequest: 3,
    }),
    fallback: "allow",
  });
  return rateLimiter.applyRateLimit(identifier, endpoint);
}
