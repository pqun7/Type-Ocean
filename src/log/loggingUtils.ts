// src/log/loggingUtils.ts
// حماية من التنفيذ في المتصفح
if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("loggingUtils should not be imported on the client side. Use clientLogger instead.");
}

import { logging } from "@/log/ServerLogger";


export const createLogMetadata = (
  requestId: string,
  type: string,
  metadata?: object,
  filePath?: string
) => ({
  type: type.toUpperCase(),
  requestId,
  filePath: filePath || __filename, // استخدام المسار الممر أو مسار الملف الحالي
  ...metadata,
});

export const logRequestStart = (
  requestId: string,
  type: string,
  method: string,
  userId?: string | null,
  filePath?: string // إضافة معامل لمسار الملف
) => {
  logging.info(
    `[${method}] Request started`,
    createLogMetadata(requestId, type, { 
      userId,
      operation: "request_start"
    }, filePath) // تمرير filePath
  );
};

export const logRequestSuccess = (
  requestId: string,
  type: string,
  method: string,
  metadata?: object,
  filePath?: string 
) => {
  logging.info(
    `[${method}] Request completed`,
    createLogMetadata(requestId, type, {
      ...metadata,
      operation: "request_complete"
    }, filePath)
  );
};

export const logRequestError = (
  requestId: string,
  type: string,
  error: unknown,
  metadata?: object,
  filePath?: string// إضافة معامل لمسار الملف
) => {
  const errorObj = error instanceof Error ? error : new Error(String(error));
  logging.error(
    `Request failed: ${errorObj.message}`,
    errorObj,
    createLogMetadata(requestId, type, {
      ...metadata,
      operation: "request_error"
    }, filePath) // تمرير filePath
  );
};