// حماية من التنفيذ في المتصفح
if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("ServerLogger should not be imported on the client side. Use ClientLogger instead.");
}

import * as Sentry from "@sentry/nextjs";

// 1. إعدادات الأمان المتقدمة
const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'apiKey', 'authorization', 'creditCard',
  'sessionToken', 'refreshToken', 'privateKey', 'secret'
]);
const MAX_LOG_SIZE = 1024 * 1024 * 5; // 5MB
const MAX_LOG_FILES = 5;

// 2. أنواع البيانات
type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'silly';
type LogMeta = Record<string, unknown> | Error;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  stack?: string;
  service?: string;
  environment?: string;
}

interface LoggerInterface {
  info(message: string, meta?: LogMeta): void;
  error(message: string, error: Error | unknown, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  debug(message: string, meta?: LogMeta): void;
  debugSensitive(operation: string, data: Record<string, unknown>): void;
}

// 3. نظام التصحيح الآمن للبيانات الحساسة
class SafeDebugLogger {
  private isDevelopment: boolean;
  private debugEnabled: boolean;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.debugEnabled = process.env.DEBUG_SENSITIVE !== 'false';
  }

  logSensitive(operation: string, data: Record<string, unknown>): void {
    const shouldLogSensitive = this.isDevelopment && this.debugEnabled;
    
    if (shouldLogSensitive) {
      console.log(`[DEV-SENSITIVE] ${operation}:`, data);
    } else {
      // في الإنتاج، طباعة نسخة معدلة
      const redactedData = this.redactSensitiveData(data);
      const envLabel = this.isDevelopment ? 'DEV' : 'PROD';
      console.log(`[${envLabel}] ${operation}:`, redactedData);
    }
  }

  private redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...data };
    const sensitiveFields = ['email', 'username', 'password', 'token', 'ip', 'phone'];
    
    sensitiveFields.forEach(field => {
      if (redacted[field]) {
        redacted[field] = '[REDACTED]';
      }
    });
    
    return redacted;
  }

  createDevelopmentMetadata(meta: Record<string, unknown>): Record<string, unknown> {
    if (this.isDevelopment && this.debugEnabled) {
      return meta; // إرجاع البيانات الكاملة في التطوير
    }
    return this.redactSensitiveData(meta); // تعديل البيانات في الإنتاج
  }
}

// 4. إعدادات التنسيق والتنقية
const simpleRedactor = {
  redact: (text: string): string => {
    // إذا كنا في وضع التطوير والتصحيح مفعل، لا تقم بالتعديل
    if (process.env.NODE_ENV === 'development' && process.env.DEBUG_SENSITIVE !== 'false') {
      return text;
    }
    
    return text
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]')
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD_REDACTED]')
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [TOKEN_REDACTED]')
      .replace(/password["\s]*[:=]["\s]*[^"\s,}]+/gi, 'password: "[REDACTED]"')
      .replace(/(username|user)["\s]*[:=]["\s]*[^"\s,}]+/gi, '$1: "[REDACTED]"');
  }
};

const cleanMetadata = (obj: Record<string, unknown>): Record<string, unknown> => {
  const isDevDebug = process.env.NODE_ENV === 'development' && process.env.DEBUG_SENSITIVE !== 'false';
  
  if (isDevDebug) {
    return obj; // في التطوير مع التصحيح، إرجاع البيانات كما هي
  }
  
  return Object.entries(obj).reduce((acc, [key, value]) => {
    if (SENSITIVE_FIELDS.has(key)) {
      acc[key] = '*****';
      return acc;
    }
    
    if (typeof value === 'object' && value !== null && !(value instanceof Error)) {
      acc[key] = cleanMetadata(value as Record<string, unknown>);
    } else if (typeof value === 'string') {
      acc[key] = simpleRedactor.redact(value);
    } else {
      acc[key] = value;
    }
    
    return acc;
  }, {} as Record<string, unknown>);
};

// 5. نظام إدارة الملفات للـ Logs
type FsModule = typeof import("fs");
type PathModule = typeof import("path");

const isNodeRuntime =
  typeof globalThis.process !== "undefined" &&
  globalThis.process.release?.name === "node" &&
  globalThis.process.env?.NEXT_RUNTIME !== "edge";

let fsModule: FsModule | null = null;
let pathModule: PathModule | null = null;

if (isNodeRuntime) {
  try {
    const nodeRequire = eval("require") as typeof require;
    fsModule = nodeRequire("fs");
    pathModule = nodeRequire("path");
  } catch {
    fsModule = null;
    pathModule = null;
  }
}

const canUseFileSystem = Boolean(fsModule && pathModule);

class FileLogManager {
  private ensureLogsDirectory(): string | null {
    if (!canUseFileSystem) return null;
    const path = pathModule!;
    const fs = fsModule!;
    const logsDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    return logsDir;
  }

  private shouldRotate(filePath: string): boolean {
    if (!canUseFileSystem) return false;
    const fs = fsModule!;
    try {
      const stats = fs.statSync(filePath);
      return stats.size >= MAX_LOG_SIZE;
    } catch {
      return false;
    }
  }

  private rotateFile(filePath: string) {
    if (!canUseFileSystem) return;
    const fs = fsModule!;
    if (!fs.existsSync(filePath)) return;
    for (let i = MAX_LOG_FILES - 1; i > 0; i--) {
      const oldFile = `${filePath}.${i}`;
      const newFile = `${filePath}.${i + 1}`;
      if (fs.existsSync(oldFile)) {
        if (i === MAX_LOG_FILES - 1) {
          fs.unlinkSync(oldFile);
        } else {
          fs.renameSync(oldFile, newFile);
        }
      }
    }
    fs.renameSync(filePath, `${filePath}.1`);
  }

  writeToFile(filename: string, entry: string) {
    if (!canUseFileSystem) return;
    const fs = fsModule!;
    const path = pathModule!;
    try {
      const logsDir = this.ensureLogsDirectory();
      if (!logsDir) return;
      const filePath = path.join(logsDir, filename);

      if (this.shouldRotate(filePath)) {
        this.rotateFile(filePath);
      }

      fs.appendFileSync(filePath, entry + "\n", "utf8");
    } catch (error) {
      // Avoid printing in production
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to write log file:", error);
      }
    }
  }
}

// 6. نظام النقل (Transports)
class SentryTransport {
  private readonly levelMap = new Map<string, Sentry.SeverityLevel>([
    ['error', 'error'],
    ['warn', 'warning'],
    ['info', 'info'],
    ['debug', 'debug'],
    ['verbose', 'debug'],
    ['silly', 'debug'],
  ]);

  log(entry: LogEntry) {
    const severity = this.levelMap.get(entry.level) || 'error';
    
    Sentry.withScope(scope => {
      scope.setLevel(severity);
      scope.setExtras(entry.metadata || {});
      
      if (entry.metadata?.error instanceof Error) {
        Sentry.captureException(entry.metadata.error);
      } else {
        Sentry.captureMessage(entry.message);
      }
    });
  }
}

class ConsoleTransport {
  private colors = {
    error: '\x1b[31m', // red
    warn: '\x1b[33m', // yellow
    info: '\x1b[36m', // cyan
    debug: '\x1b[35m', // magenta
    verbose: '\x1b[90m', // gray
    silly: '\x1b[90m', // gray
    reset: '\x1b[0m'
  };

  log(entry: LogEntry) {
    // No printing in production for console (we use file transport instead)
    if (process.env.NODE_ENV === "production") return;

    const color = this.colors[entry.level] || this.colors.reset;
    const timestamp = entry.timestamp;
    let output = `${color}[${timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${this.colors.reset}`;
    
    if (entry.stack) {
      output += `\n${entry.stack}`;
    }
    
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      output += `\n${JSON.stringify(entry.metadata, null, 2)}`;
    }
    
    console.log(output);
  }
}

class FileTransport {
  private fileManager = new FileLogManager();

  log(entry: LogEntry) {
    if (!canUseFileSystem) return;
    
    // تأكد من تعديل البيانات الحساسة في ملفات السجل دائماً
    const safeEntry = {
      ...entry,
      metadata: cleanMetadata(entry.metadata || {}),
      environment: process.env.NODE_ENV
    };
    
    const logEntry = JSON.stringify(safeEntry);

    this.fileManager.writeToFile("combined.log", logEntry);

    if (entry.level === "error") {
      this.fileManager.writeToFile("errors.log", logEntry);
    }
  }
}

// 7. الـ Logger الرئيسي المحسن
class ServerLogger {
  private level: LogLevel;
  private transports: (ConsoleTransport | FileTransport | SentryTransport)[];
  private fileManager: FileLogManager;
  private safeDebug: SafeDebugLogger;

  constructor() {
    this.level = (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.fileManager = new FileLogManager();
    this.safeDebug = new SafeDebugLogger();
    this.transports = this.initializeTransports();
  }

  private initializeTransports() {
    const transports: (ConsoleTransport | FileTransport | SentryTransport)[] = [
      new SentryTransport()
    ];

    if (process.env.NODE_ENV === "production") {
      if (canUseFileSystem) {
        transports.push(new FileTransport());
      }
    } else {
      // في التطوير، استخدم ConsoleTransport و FileTransport
      transports.push(new ConsoleTransport());
      if (canUseFileSystem) {
        transports.push(new FileTransport());
      }
    }

    return transports;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug', 'verbose', 'silly'];
    const currentLevelIndex = levels.indexOf(this.level);
    const messageLevelIndex = levels.indexOf(level);
    
    return messageLevelIndex <= currentLevelIndex;
  }

  private createLogEntry(level: LogLevel, message: string, meta?: LogMeta): LogEntry {
    const timestamp = new Date().toISOString();
    let metadata: Record<string, unknown> = {};
    let stack: string | undefined;

    // معالجة metadata
    if (meta instanceof Error) {
      metadata = { error: meta };
      stack = meta.stack;
    } else if (meta && typeof meta === 'object') {
      metadata = cleanMetadata(meta);
    }

    // تنظيف الرسالة
    const cleanMessage = simpleRedactor.redact(message);

    return {
      timestamp,
      level,
      message: cleanMessage,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      stack,
      service: process.env.SERVICE_NAME || 'backend-service',
      environment: process.env.NODE_ENV,
    };
  }

  private log(level: LogLevel, message: string, meta?: LogMeta) {
    if (!this.shouldLog(level)) return;

    const entry = this.createLogEntry(level, message, meta);
    
    this.transports.forEach(transport => {
      try {
        transport.log(entry);
      } catch (error) {
        // تجنب loops لا نهائية عند فشل الـ logging
        if (transport instanceof ConsoleTransport) {
          console.error('Logging transport failed:', error);
        }
      }
    });
  }

  info(message: string, meta?: LogMeta) {
    this.log('info', message, meta);
  }

  error(message: string, error: Error | unknown, meta?: LogMeta) {
    const payload = error instanceof Error 
      ? { error, ...(meta as object) }
      : { details: error, ...(meta as object) };
      
    this.log('error', message, payload);
  }

  warn(message: string, meta?: LogMeta) {
    this.log('warn', message, meta);
  }

  debug(message: string, meta?: LogMeta) {
    this.log('debug', message, meta);
  }

  // دالة جديدة للتصحيح الآمن للبيانات الحساسة
  debugSensitive(operation: string, data: Record<string, unknown>) {
    this.safeDebug.logSensitive(operation, data);
  }
}

// 8. التهيئة والتصدير
export const logger = new ServerLogger();

export const logging: LoggerInterface = {
  info: (message, meta) => logger.info(message, meta),
  error: (message, error, meta) => logger.error(message, error, meta),
  warn: (message, meta) => logger.warn(message, meta),
  debug: (message, meta) => logger.debug(message, meta),
  debugSensitive: (operation, data) => logger.debugSensitive(operation, data),
};

// معالجة الاستثناءات غير المعالجة
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', reason, { promise });
});