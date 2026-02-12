// src/lib/rateLimiter.ts
import "server-only";

import Redis from "ioredis";
import { createHash, randomUUID } from "crypto";
import { logger } from "@/log/ServerLogger";
import {
  logRequestStart,
  logRequestSuccess,
  logRequestError,
} from "@/log/loggingUtils";
import { NextRequest, NextResponse } from "next/server";
import { redisManager } from "@/lib/redis"; 

// 1. أنواع البيانات
type RateLimitConfig = {
  limit: number;
  windowMs: number;
  strategy?: "token-bucket" | "fixed-window" | "sliding-window";
  burstAllowed?: boolean;
};

// 1.5. إعدادات نقاط النهاية
const ENDPOINT_CONFIGS: Record<string, RateLimitConfig> = {
  "/api/auth/login": {
    limit: 3,
    windowMs: 15_000,
    strategy: "fixed-window",
  },
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
  windowMs: 60 * 1000,
  strategy: "token-bucket",
  burstAllowed: false,
};

const DEFAULT_OPTIONS: RateLimitOptions = {
  namespace: "rate-limit",
  fallback: "allow",
};

// 4. فئة RateLimiter المحسنة
export class RateLimiter {
  private redis: Redis;
  private configs: Map<string, RateLimitConfig>;
  private options: RateLimitOptions;
  private localCache = new Map<string, { count: number; expires: number }>();

  constructor(
    configs: Record<string, RateLimitConfig> = {},
    options: RateLimitOptions = {}
  ) {
    // استخدام عميل Redis المشترك من RedisManager
    this.redis = options.redisClient || redisManager.getClient();
    this.configs = new Map(Object.entries(configs));
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // 4. تطبيق Rate Limit الأساسي
  async applyRateLimit(
    identifier: string | NextRequest,
    endpoint: string
  ): Promise<{ allowed: boolean; headers: Record<string, string> }> {
    const logType = "RATE_LIMIT";
    const requestId = randomUUID();

    const resolvedIdentifier =
      typeof identifier === "string"
        ? identifier
        : RateLimiter.extractIdentifierFromRequest(identifier);

    logRequestStart(requestId, logType, "RATE_LIMIT", resolvedIdentifier);

    if (!resolvedIdentifier || !endpoint) {
      const isAllowed = this.options.fallback === "allow";
      logRequestSuccess(requestId, logType, "RATE_LIMIT", {
        allowed: isAllowed,
        reason: "missing_identifier_or_endpoint",
        endpoint,
      });
      return {
        allowed: isAllowed,
        headers: {},
      };
    }

    try {
      const config = this.getConfig(endpoint);

      const key = this.generateKey(resolvedIdentifier, endpoint);
      let result: boolean;

      switch (config.strategy) {
        case "token-bucket":
          result = await this.tokenBucket(key, config);
          break;
        case "sliding-window":
          result = await this.slidingWindow(key, config);
          break;
        case "fixed-window":
          result = await this.fixedWindow(key, config);
          break;
        default:
          result = await this.fixedWindow(key, config);
      }

      return {
        allowed: result,
        headers: this.generateHeaders(result, config),
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logRequestError(requestId, logType, error, {
        endpoint,
        errorDetails: errorMessage,
      });
      
      // العودة إلى الكاش المحلي في حالة الخطأ
      return this.handleLocalRateLimit(resolvedIdentifier, endpoint);
    }
  }

  private static extractIdentifierFromRequest(req: NextRequest): string {
    // Prefer explicit proxy headers. Fall back to a stable anonymous key.
    const xForwardedFor = req.headers.get("x-forwarded-for");
    const cfConnectingIp = req.headers.get("cf-connecting-ip");
    const xRealIp = req.headers.get("x-real-ip");

    if (cfConnectingIp) return cfConnectingIp.trim();
    if (xRealIp) return xRealIp.trim();
    if (xForwardedFor) return xForwardedFor.split(",")[0]?.trim() || "anonymous";

    return "anonymous";
  }

  private handleLocalRateLimit(
    identifier: string, 
    endpoint: string
  ): { allowed: boolean; headers: Record<string, string> } {
    const localKey = `${identifier}:${endpoint}`;
    const config = this.getConfig(endpoint);
    
    if (!config) {
      return {
        allowed: this.options.fallback === "allow",
        headers: {},
      };
    }

    const cached = this.localCache.get(localKey);
    const now = Date.now();

    // تنظيف الكاش القديم تلقائياً
    if (cached && cached.expires <= now) {
      this.localCache.delete(localKey);
    }

    const currentCache = this.localCache.get(localKey);
    
    if (currentCache) {
      if (currentCache.count >= config.limit) {
        return {
          allowed: false,
          headers: this.generateHeaders(false, config),
        };
      }
      currentCache.count++;
    } else {
      this.localCache.set(localKey, {
        count: 1,
        expires: now + config.windowMs,
      });
    }

    return {
      allowed: true,
      headers: this.generateHeaders(true, config),
    };
  }

  // 5. Token Bucket Algorithm محسن
  private async tokenBucket(key: string, config: RateLimitConfig): Promise<boolean> {
    const now = Date.now();
    
    try {
      const data = await this.redis.hgetall(key);
      
      let tokens = parseFloat(data?.tokens || config.limit.toString());
      const lastTime = data?.last ? parseInt(data.last) : now;

      const elapsed = now - lastTime;
      const refill = (elapsed * config.limit) / config.windowMs;
      tokens = Math.min(tokens + refill, config.limit);

      if (tokens < 1) return false;

      tokens -= 1;

      await this.redis
        .pipeline()
        .hset(key, "tokens", tokens.toString())
        .hset(key, "last", now.toString())
        .pexpire(key, config.windowMs)
        .exec();

      return true;
    } catch (error) {
      logger.error("Token bucket algorithm failed", { error, key });
      throw error;
    }
  }

  // 6. Sliding Window Algorithm محسن
  private async slidingWindow(key: string, config: RateLimitConfig): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      const transaction = this.redis.multi();
      transaction.zremrangebyscore(key, 0, windowStart);
      transaction.zcard(key);
      transaction.zadd(key, now, `${now}-${Math.random().toString(36).substring(2, 15)}`);
      transaction.pexpire(key, config.windowMs);

      const results = await transaction.exec();
      
      if (!results || results.length < 2) {
        throw new Error("Redis transaction failed");
      }

      const rawCount = results[1]?.[1];
      const count = Number(rawCount ?? 0);

      if (!Number.isFinite(count)) {
        throw new Error("Redis zcard returned non-numeric result");
      }

      return count <= config.limit;
    } catch (error) {
      logger.error("Sliding window algorithm failed", { error, key });
      throw error;
    }
  }

  // 6.5. Fixed Window Algorithm محسن
  private async fixedWindow(key: string, config: RateLimitConfig): Promise<boolean> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.pexpire(key, config.windowMs);
      }
      return count <= config.limit;
    } catch (error) {
      logger.error("Fixed window algorithm failed", { error, key });
      throw error;
    }
  }

  // 7. توليد المفاتيح الآمنة مع تحسين الأداء
  private generateKey(identifier: string, endpoint: string): string {
    const safeIdentifier = createHash("sha256").update(identifier).digest("hex");
    const safeEndpoint = endpoint.replace(/[^\w:-]/g, "_");
    return `${this.options.namespace}:${safeIdentifier}:${safeEndpoint}`;
  }

  // 8. توليد رؤوس الاستجابة
  private generateHeaders(allowed: boolean, config: RateLimitConfig): Record<string, string> {
    const resetTime = Date.now() + config.windowMs;
    const headers: Record<string, string> = {
      "X-RateLimit-Limit": config.limit.toString(),
      "X-RateLimit-Remaining": allowed ? Math.max(0, config.limit - 1).toString() : "0",
      "X-RateLimit-Reset": Math.ceil(resetTime / 1000).toString(), // تحويل إلى ثواني
    };
    
    if (!allowed) {
      headers["Retry-After"] = Math.ceil(config.windowMs / 1000).toString();
    }
    
    return headers;
  }

  // 9. الحصول على التهيئة مع القيم الافتراضية
  private getConfig(endpoint: string): RateLimitConfig {
    return this.configs.get(endpoint) || ENDPOINT_CONFIGS[endpoint] || { ...DEFAULT_CONFIG };
  }
}

// 11. تهيئة افتراضية للاستخدام العام
export const rateLimiter = new RateLimiter(
  {
    "/api/home/auth:GET": {
      limit: 240,
      windowMs: 60_000,
      strategy: "fixed-window",
    },
    "/api/home/bootstrap:GET": {
      limit: 120,
      windowMs: 60_000,
      strategy: "fixed-window",
    },
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
    // استخدام RedisManager الموحد
    redisClient: redisManager.getClient(),
    fallback: "allow",
  }
);

// 12. دالة applyRateLimit موحدة تستخدم الفئة الرئيسية
export async function applyRateLimit(req: NextRequest, endpoint: string) {
  // تحسين استخراج IP
  const xForwardedFor = req.headers.get("x-forwarded-for");
  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  const xRealIp = req.headers.get("x-real-ip");
  
  let identifier = "anonymous";
  
  if (cfConnectingIp) {
    identifier = cfConnectingIp;
  } else if (xRealIp) {
    identifier = xRealIp;
  } else if (xForwardedFor) {
    identifier = xForwardedFor.split(",")[0].trim();
  }

  logger.debug("Rate limit identifier", { identifier, endpoint });

  return rateLimiter.applyRateLimit(identifier, endpoint);
}

// 13. دالة enforceRateLimit مبسطة
export async function enforceRateLimit(req: NextRequest, endpoint: string) {
  const { allowed, headers } = await applyRateLimit(req, endpoint);

  if (!allowed) {
    return NextResponse.json(
      { 
        error: "Too many requests", 
        message: "Rate limit exceeded. Please try again later." 
      },
      {
        status: 429,
        headers: headers,
      }
    );
  }

  return headers;
}

// 14. دالة checkRateLimit مبسطة
export async function checkRateLimit(endpoint: string, identifier: string) {
  return rateLimiter.applyRateLimit(identifier, endpoint);
}

// دالة للتهيئة عند بدء التشغيل
export async function initializeRateLimiter(): Promise<void> {
  try {
    await redisManager.connectIfNeeded();
    logger.info("Rate limiter initialized successfully");
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Rate limiter initialization warning", { error: errorMessage });
  }
}