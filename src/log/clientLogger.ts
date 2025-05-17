// src/log/clientLogger.ts
import { XPMessage } from '@/types/level';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = 'AUTH' | 'PERF' | 'XP' | 'CHALLENGE' | 'SESSION' | 'ERROR';

const LOG_CONFIG = {
  LEVEL: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  SENSITIVE_FIELDS: ['password', 'token', 'authorization'],
  MAX_STRING_LENGTH: 500,
};

const LogLevelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class ClientLogger {
  private readonly context: string;
  private readonly minLevel: number;

  constructor(context: string) {
    this.context = `[${context.toUpperCase()}]`;
    this.minLevel = LogLevelPriority[LOG_CONFIG.LEVEL as LogLevel];
  }

  private shouldLog(level: LogLevel): boolean {
    return LogLevelPriority[level] >= this.minLevel;
  }

  private sanitizeData(data: unknown): unknown {
    if (process.env.NODE_ENV !== 'production') return data;
    
    const sanitize = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      return Object.entries(obj).reduce((acc, [key, value]) => {
        acc[key] = LOG_CONFIG.SENSITIVE_FIELDS.includes(key) 
          ? '***' 
          : typeof value === 'string' 
            ? value.slice(0, LOG_CONFIG.MAX_STRING_LENGTH) 
            : sanitize(value);
        return acc;
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
      : `[${logEntry.timestamp}] ${logEntry.level} ${logEntry.context} ${logEntry.message}`;
  }

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
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

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, error?: Error, meta?: Record<string, unknown>): void {
    this.log('error', message, { ...meta, error });
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
export const XP_LOGGING_THRESHOLDS = {
  BASE: 50,
  BONUS: 100,
  LEVEL_UP: 200,
};

export const XP_MESSAGE_TIMEOUT = {
  BASE: 3000,
  BONUS: 4000,
  LEVEL_UP: 5000,
};

export const logXPEvent = (
  userId: string,
  event: XPMessage,
  metadata?: Record<string, unknown>
): void => {
  if (event.value >= XP_LOGGING_THRESHOLDS[event.type.toUpperCase() as keyof typeof XP_LOGGING_THRESHOLDS]) {
    logger.xp.info(`XP Event: ${event.type}`, {
      userId,
      eventType: event.type,
      value: event.value,
      ...metadata,
    });
  }
};