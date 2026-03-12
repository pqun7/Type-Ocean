export const PVP_ERROR_CODES = {
  QUEUE_SOCKET_NOT_READY: "PVP_QUEUE_SOCKET_NOT_READY",
  QUEUE_CONNECTION_CLOSED: "PVP_QUEUE_CONNECTION_CLOSED",
  QUEUE_GATEWAY_DRAINING: "PVP_QUEUE_GATEWAY_DRAINING",
  QUEUE_USER_UNAVAILABLE: "PVP_QUEUE_USER_UNAVAILABLE",
  QUEUE_ALREADY_SEARCHING: "PVP_QUEUE_ALREADY_SEARCHING",
  QUEUE_MATCH_CREATION_FAILED: "PVP_QUEUE_MATCH_CREATION_FAILED",
  QUEUE_AI_FALLBACK_FAILED: "PVP_QUEUE_AI_FALLBACK_FAILED",
} as const;

export type PvpErrorCode = (typeof PVP_ERROR_CODES)[keyof typeof PVP_ERROR_CODES];

export type PvpErrorPayload = {
  message: string;
  code?: PvpErrorCode;
  retryable?: boolean;
  details?: {
    requestId?: string;
    phase?: string;
  };
};

export function isPvpErrorCode(value: unknown): value is PvpErrorCode {
  return typeof value === "string" && Object.values(PVP_ERROR_CODES).includes(value as PvpErrorCode);
}
