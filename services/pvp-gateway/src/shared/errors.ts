/**
 * @module shared/errors
 *
 * Gateway-specific error classes, error-mapping utilities, and auth failure
 * helpers.
 *
 * ## Error taxonomy
 *
 * ```
 * Error
 * └── PvpClientVisibleError        — carries a typed PvpErrorPayload
 *                                    that is sent directly to the client.
 *     └── (thrown by buildQueueError, etc.)
 * ```
 *
 * ## Import policy
 * This module imports only from:
 * - npm packages (`crypto`)
 * - `../../../src/features/pvp/shared/error-codes` (shared Next.js type)
 *
 * It must **not** import from other gateway modules (would create circular deps).
 */

import crypto from "crypto";
import { PVP_ERROR_CODES, type PvpErrorPayload } from "../../../../src/features/pvp/shared/error-codes";

// =============================================================================
// CLIENT-VISIBLE ERROR
// =============================================================================

/**
 * An error that carries a fully typed {@link PvpErrorPayload}.
 *
 * When this error reaches a message-handler's top-level catch, the handler
 * must send `payload` to the client as a `PVP_ERROR` message instead of a
 * generic "internal error" response.
 *
 * @example
 * ```ts
 * throw new PvpClientVisibleError({
 *   code: PVP_ERROR_CODES.QUEUE_FULL,
 *   message: "Queue is full. Please try again.",
 *   retryable: true,
 * });
 * ```
 */
export class PvpClientVisibleError extends Error {
  /** The typed payload that will be forwarded to the WebSocket client. */
  readonly payload: PvpErrorPayload;

  constructor(payload: PvpErrorPayload) {
    super(payload.message);
    this.name = "PvpClientVisibleError";
    this.payload = payload;
  }
}

// =============================================================================
// ERROR FACTORIES
// =============================================================================

/**
 * Wraps a {@link PvpErrorPayload} in a {@link PvpClientVisibleError}.
 *
 * Convenience factory that gives the call site a more expressive name than
 * `new PvpClientVisibleError(...)`.
 *
 * @param payload - The typed error payload to carry.
 */
export function buildQueueError(payload: PvpErrorPayload): PvpClientVisibleError {
  return new PvpClientVisibleError(payload);
}

// =============================================================================
// ERROR CONVERSION
// =============================================================================

/**
 * Converts any thrown value into a {@link PvpErrorPayload} suitable for
 * sending to the client.
 *
 * - If `error` is a {@link PvpClientVisibleError}, its payload is returned
 *   (merged with any `fallback` overrides).
 * - Otherwise a generic payload is constructed from `fallback` or the error
 *   message.
 *
 * @param error    - Any caught value (`unknown`).
 * @param fallback - Optional overrides / defaults for missing fields.
 */
export function toClientErrorPayload(
  error: unknown,
  fallback?: Partial<PvpErrorPayload>,
): PvpErrorPayload {
  if (error instanceof PvpClientVisibleError) {
    return {
      ...error.payload,
      ...fallback,
      details: {
        ...error.payload.details,
        ...fallback?.details,
      },
    };
  }

  return {
    message:
      fallback?.message ??
      (error instanceof Error ? error.message : "Unknown error"),
    code: fallback?.code,
    retryable: fallback?.retryable,
    details: fallback?.details,
  };
}

// =============================================================================
// AUTH FAILURE MAPPING
// =============================================================================

/**
 * Converts a JWT-verification failure into a structured {@link PvpErrorPayload}
 * with the appropriate {@link PVP_ERROR_CODES} code and a user-friendly message.
 *
 * Centralising this mapping ensures consistent client-facing error codes
 * regardless of which handler triggered the auth failure.
 *
 * @param error - The caught JWT verification error.
 */
export function mapHelloAuthFailure(error: unknown): PvpErrorPayload {
  const rawMessage = error instanceof Error ? error.message : "Authentication failed";
  const message = rawMessage.toLowerCase();

  if (message.includes("expired") || message.includes("jwt expired")) {
    return {
      code: PVP_ERROR_CODES.TOKEN_EXPIRED,
      message: "Websocket token expired. Please refresh and try again.",
      retryable: true,
    };
  }

  if (message.includes("fingerprint") || message.includes("client secret")) {
    return {
      code: PVP_ERROR_CODES.BAD_SECRET,
      message: "Invalid websocket client secret.",
      retryable: false,
    };
  }

  if (
    message.includes("invalid token") ||
    message.includes("subject") ||
    message.includes("security claims") ||
    message.includes("jws") ||
    message.includes("jwt")
  ) {
    return {
      code: PVP_ERROR_CODES.INVALID_TOKEN,
      message: "Invalid websocket token.",
      retryable: false,
    };
  }

  return {
    code: PVP_ERROR_CODES.AUTH_FAILED,
    message: "Authentication failed.",
    retryable: false,
  };
}

// =============================================================================
// JWT DECODE HELPERS
// =============================================================================

/**
 * Decodes the payload segment of a JWT **without verifying the signature**.
 *
 * This is intentionally unsafe — use it only in the auth-bypass path for
 * load testing.  For real authentication, use `verifyWsTokenStrict` from
 * `./auth`.
 *
 * @param token - A raw JWT string (header.payload.signature).
 * @returns The decoded payload object, or `null` if decoding fails.
 */
export function decodeJwtPayloadUnsafe(
  token: string,
): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding =
      base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
    const payload = Buffer.from(`${base64}${padding}`, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(payload);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// =============================================================================
// CRYPTO HELPERS
// =============================================================================

/**
 * Generates a cryptographically random input nonce (32 hex characters).
 *
 * Used as the anti-replay `inputNonce` included in every MATCH_FOUND payload.
 * The nonce is stored server-side; clients must echo it in every INPUT_UPDATE.
 * This prevents replaying intercepted input sequences.
 *
 * See P11 in `problem.md`.
 */
export function createInputNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

// =============================================================================
// TYPE GUARDS / MISC UTILITIES
// =============================================================================

/**
 * Returns `true` if `userId` belongs to an AI bot participant.
 *
 * AI user IDs follow the convention `"ai:<descriptor>"` set by the AI
 * simulation module.
 *
 * @param userId - Any user identifier string.
 */
export function isAiUserId(userId: string): boolean {
  return userId.startsWith("ai:");
}

/**
 * Coerces any value to a millisecond epoch timestamp.
 *
 * Handles `Date` objects, ISO strings, and numeric timestamps.  Returns
 * `fallbackMs` if the value cannot be parsed into a finite number.
 *
 * @param value      - The value to coerce.
 * @param fallbackMs - Returned when coercion fails.
 */
export function toEpochMs(value: unknown, fallbackMs: number): number {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : fallbackMs;
  }

  if (typeof value === "string" || typeof value === "number") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : fallbackMs;
  }

  return fallbackMs;
}

/**
 * Extracts the `averageWPM` field from an opaque `longTermStats` JSON blob.
 *
 * Returns `null` if the field is absent, non-numeric, or infinite / NaN.
 * The result is rounded to the nearest integer.
 *
 * @param longTermStats - The raw stats blob from the player profile.
 */
export function extractAverageWpm(longTermStats: unknown): number | null {
  if (!longTermStats || typeof longTermStats !== "object") return null;

  const averageWpm = (longTermStats as Record<string, unknown>).averageWPM;
  if (typeof averageWpm !== "number" || !Number.isFinite(averageWpm)) {
    return null;
  }

  return Math.max(0, Math.round(averageWpm));
}
