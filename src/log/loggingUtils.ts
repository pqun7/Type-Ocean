// src/log/loggingUtils.ts
import { logging } from "@/log/ServerLogger";

export const createLogMetadata = (requestId: string, type: string, metadata?: object) => ({
  type: type.toUpperCase(),
  requestId,
  ...metadata,
});

export const logRequestStart = (requestId: string, type: string, method: string, userId?: string | null) => {
  logging.info(`[${method}] Request started`, createLogMetadata(requestId, type, { 
    userId,
    operation: "request_start"
  }));
};

export const logRequestSuccess = (requestId: string, type: string, method: string, metadata?: object) => {
  logging.info(`[${method}] Request completed`, createLogMetadata(requestId, type, {
    ...metadata,
    operation: "request_complete"
  }));
};

export const logRequestError = (requestId: string, type: string, error: unknown, metadata?: object) => {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  logging.error(`Request failed: ${errorObj.message}`, errorObj, createLogMetadata(requestId, type, {
    ...metadata,
    operation: "request_error"
  }));
};