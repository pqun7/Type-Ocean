// serverLogger.ts
import * as Sentry from "@sentry/nextjs";
import winston, { format } from "winston";
import TransportStream from "winston-transport";
import { SyncRedactor } from 'redact-pii';

// 1. إعدادات الأمان المتقدمة
const SENSITIVE_FIELDS = new Set(['password', 'token', 'apiKey', 'authorization', 'creditCard']);
const MAX_LOG_SIZE = 1024 * 1024 * 5; // 5MB
const MAX_LOG_FILES = 5;
const LOG_ARCHIVE_ENABLED = process.env.LOG_ARCHIVE === 'true';

const redactor = new SyncRedactor({

  globalReplaceWith: '*****'
});

// 2. تنسيقات مخصصة مع تحسينات الأداء
const { combine, timestamp, printf, colorize, errors } = format;

const sensitiveDataFormatter = format((info) => {
  const cleanMetadata = (obj: Record<string, unknown>): Record<string, unknown> => {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (SENSITIVE_FIELDS.has(key)) {
        acc[key] = redactor.redact(String(value));
        return acc;
      }
      
      if (typeof value === 'object' && value !== null) {
        acc[key] = cleanMetadata(value as Record<string, unknown>);
      } else {
        acc[key] = value;
      }
      
      return acc;
    }, {} as Record<string, unknown>);
  };

  if (info.metadata && typeof info.metadata === 'object') {
    info.metadata = cleanMetadata(info.metadata as Record<string, unknown>);
  }
  
  return info;
});

const productionFormat = printf(({ level, message, timestamp }) => {
  return JSON.stringify({
    timestamp,
    level: level.toUpperCase(),
    message,
    env: process.env.NODE_ENV
  });
});

const developmentFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
  let output = `[${timestamp}] [${level}] ${message}`;
  if (stack) output += `\n${stack}`;
  if (metadata && Object.keys(metadata).length > 0) {
    output += `\n${JSON.stringify(metadata, null, 2)}`;
  }
  return output;
});

// 3. تحسينات Sentry مع إدارة السياق
class SentryTransport extends TransportStream {
  private readonly levelMap = new Map<string, Sentry.SeverityLevel>([
    ['error', 'error'],
    ['warn', 'warning'],
    ['info', 'info'],
    ['debug', 'debug'],
    ['verbose', 'debug'],
    ['silly', 'debug'],
  ]);

  constructor(opts: TransportStream.TransportStreamOptions) {
    super(opts);
  }

  log(info: any, callback: () => void) {
    const severity = this.levelMap.get(info.level) || 'error';
    const extras = { ...info, level: undefined, message: undefined };

    Sentry.withScope(scope => {
      scope.setLevel(severity);
      scope.setExtras(extras);

      if (info.error instanceof Error) {
        Sentry.captureException(info.error);
      } else {
        Sentry.captureMessage(info.message);
      }
    });

    callback();
  }
}

// 4. نظام التخزين الديناميكي
const getTransports = (): TransportStream[] => {
  const transports: TransportStream[] = [
    new SentryTransport({
      level: 'error',
      handleExceptions: true,
      handleRejections: true,
    })
  ];

  if (process.env.NODE_ENV === 'production') {
    const fileTransportConfig = {
      maxsize: MAX_LOG_SIZE,
      maxFiles: MAX_LOG_FILES,
      zippedArchive: LOG_ARCHIVE_ENABLED,
      format: combine(sensitiveDataFormatter(), productionFormat)
    };

    transports.push(
      new winston.transports.File({
        filename: 'logs/combined.log',
        ...fileTransportConfig
      }),
      new winston.transports.File({
        filename: 'logs/errors.log',
        level: 'error',
        ...fileTransportConfig
      })
    );
  } else {
    transports.push(
      new winston.transports.Console({
        format: combine(
          colorize(),
          errors({ stack: true }),
          sensitiveDataFormatter(),
          developmentFormat
        ),
        handleExceptions: true,
        handleRejections: true,
      })
    );
  }

  return transports;
};

// 5. تهيئة الـ Logger مع إعدادات متقدمة
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    errors({ stack: true }),
    format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
    sensitiveDataFormatter(),
    format((info) => {
      info.service = process.env.SERVICE_NAME || 'backend-service';
      return info;
    })()
  ),
  transports: getTransports(),
  exitOnError: (err: Error) => {
    console.error('Logger fatal error:', err);
    return false;
  },
});

// 6. واجهة استخدام نوعية (Type-safe)
type LogMeta = Record<string, unknown> | Error;

interface LoggerInterface {
  info(message: string, meta?: LogMeta): void;
  error(message: string, error: Error | unknown, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  debug(message: string, meta?: LogMeta): void;
}

export const logging: LoggerInterface = {
  info: (message, meta) => logger.info(message, meta),

  error: (message, error, meta) => {
    const payload = error instanceof Error 
      ? { error, ...meta }
      : { details: error, ...meta };
      
    logger.error(message, payload);
  },

  warn: (message, meta) => logger.warn(message, meta),

  debug: (message, meta) => logger.debug(message, meta),
};

// 7. معالجة الأخطاء مع إعادة التحميل الآمن
const handleCriticalErrors = (error: Error) => {
  logging.error('Critical error occurred', error);
  setTimeout(() => process.exit(1), 1000); // تأخير للإتمام العمليات الحرجة
};

process.on('uncaughtException', handleCriticalErrors);
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  handleCriticalErrors(error);
});