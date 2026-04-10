type GatewayLogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: GatewayLogLevel[] = ["error", "warn", "info", "debug"];
const CURRENT_LEVEL = ((process.env.LOG_LEVEL as GatewayLogLevel | undefined) ?? (process.env.NODE_ENV === "development" ? "debug" : "info"));

function shouldLog(level: GatewayLogLevel) {
  return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(CURRENT_LEVEL);
}

function sanitizeMeta(meta?: Record<string, unknown>) {
  if (!meta) return undefined;

  const sensitiveKeys = new Set(["token", "clientSecret", "authorization", "cookie", "password", "email"]);
  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => {
      if (sensitiveKeys.has(key)) return [key, "[REDACTED]"];
      return [key, value];
    })
  );
}

function write(level: GatewayLogLevel, message: string, meta?: Record<string, unknown>, error?: unknown) {
  if (!shouldLog(level)) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    meta: sanitizeMeta(meta),
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            ...(error.cause != null
              ? {
                  cause:
                    error.cause instanceof Error
                      ? { name: (error.cause as Error).name, message: (error.cause as Error).message, stack: (error.cause as Error).stack }
                      : String(error.cause),
                }
              : {}),
          }
        : error
          ? String(error)
          : undefined,
  };

  const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  consoleMethod(`[${entry.timestamp}] [${entry.level}] ${entry.message}`);
  if (entry.meta && Object.keys(entry.meta).length > 0) {
    consoleMethod(JSON.stringify(entry.meta, null, 2));
  }
  if (entry.error) {
    consoleMethod(JSON.stringify(entry.error, null, 2));
  }
}

export const gatewayLogger = {
  debug(message: string, meta?: Record<string, unknown>) {
    write("debug", message, meta);
  },
  info(message: string, meta?: Record<string, unknown>) {
    write("info", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    write("warn", message, meta);
  },
  error(message: string, error: unknown, meta?: Record<string, unknown>) {
    write("error", message, meta, error);
  },
};