type LogLevel = 'debug' | 'info' | 'warn' | 'error';
import { XPMessage } from "@/features/level/types/level";

const LOG_CONFIG = {
  LEVEL: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  SENSITIVE_FIELDS: ['password', 'token', 'authorization', 'email', 'username'],
  MAX_STRING_LENGTH: 500,
};

const LogLevelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

import { XP_LOGGING_THRESHOLDS } from '@/features/level/constants/level';

// نظام التصحيح الآمن للعميل
class ClientSafeDebugLogger {
  private isDevelopment: boolean;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  logSensitive(operation: string, data: Record<string, unknown>): void {
    if (this.isDevelopment) {
      console.log(`[CLIENT-DEV] ${operation}:`, data);
    } else {
      // في الإنتاج، لا تسجل البيانات الحساسة
      const redactedData = this.redactSensitiveData(data);
      console.log(`[CLIENT] ${operation}:`, redactedData);
    }
  }

  private redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...data };
    LOG_CONFIG.SENSITIVE_FIELDS.forEach(field => {
      if (redacted[field]) {
        redacted[field] = '[REDACTED]';
      }
    });
    return redacted;
  }
}

class ClientLogger {
  private readonly context: string;
  private readonly minLevel: number;
  private safeDebug: ClientSafeDebugLogger;

  constructor(context: string) {
    this.context = `[${context.toUpperCase()}]`;
    this.minLevel = LogLevelPriority[LOG_CONFIG.LEVEL as LogLevel];
    this.safeDebug = new ClientSafeDebugLogger();
  }

  private shouldLog(level: LogLevel): boolean {
    return LogLevelPriority[level] >= this.minLevel;
  }

  private sanitizeData(data: unknown): unknown {
    if (process.env.NODE_ENV !== 'production') return data;
    
    const sanitize = (obj: unknown): unknown => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      const recordObj = obj as Record<string, unknown>;
      return Object.entries(recordObj).reduce((acc, [key, value]) => {
        const result = acc as Record<string, unknown>;
        result[key] = LOG_CONFIG.SENSITIVE_FIELDS.includes(key) 
          ? '***' 
          : typeof value === 'string' 
            ? value.slice(0, LOG_CONFIG.MAX_STRING_LENGTH) 
            : sanitize(value);
        return result;
      }, {} as Record<string, unknown>);
    };

    return sanitize(data);
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ): string {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      context: this.context,
      message,
      ...(meta && { meta: this.sanitizeData(meta) }),
    };

    return process.env.NODE_ENV === 'production'
      ? JSON.stringify(logEntry)
      : `[${logEntry.timestamp}] ${logEntry.level} ${logEntry.context} - ${logEntry.message}`;
  }

  log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(level, message, meta);
    const consoleMethod = console[level] || console.log;
    
    if (level === 'error' && meta?.error instanceof Error) {
      consoleMethod(formattedMessage, meta.error.stack);
    } else {
      consoleMethod(formattedMessage);
    }

    // Add production logging transports here (e.g., Sentry, CloudWatch)
    if (process.env.NODE_ENV === 'production') {
      // Example: sendToMonitoringService(logEntry);
    }
  }

  debug(
    message: string,
    meta?: Record<string, unknown>
  ): void {
    this.log('debug', message, meta);
  }

  info(
    message: string,
    meta?: Record<string, unknown>
  ): void {
    this.log('info', message, meta);
  }

  warn(
    message: string,
    meta?: Record<string, unknown>
  ): void {
    this.log('warn', message, meta);
  }

  error(
    message: string,
    error?: Error,
    meta?: Record<string, unknown>
  ): void {
    this.log('error', message, { ...meta, error });
  }

  // دالة التصحيح الآمن للبيانات الحساسة
  debugSensitive(operation: string, data: Record<string, unknown>) {
    this.safeDebug.logSensitive(operation, data);
  }
}

// Export configured logger instances
export const logger = {
  auth: new ClientLogger('AUTH'),
  perf: new ClientLogger('PERF'),
  xp: new ClientLogger('XP'),
  challenge: new ClientLogger('CHALLENGE'),
  session: new ClientLogger('SESSION'),
  error: new ClientLogger('ERROR'),
};

// XP-specific utilities
export const logXPEvent = (
  userId: string | undefined,
  event: XPMessage,
  metadata?: Record<string, unknown>
): void => {
  if (!userId) return;
  
  if (
    event.value >=
    XP_LOGGING_THRESHOLDS[
      event.type.toUpperCase() as keyof typeof XP_LOGGING_THRESHOLDS
    ]
  ) {
    logger.xp.info(
      `XP Event: ${event.type}`,
      {
        userId,
        eventType: event.type,
        value: event.value,
        ...metadata,
      }
    );
  }
};