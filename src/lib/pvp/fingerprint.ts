import crypto from "crypto";

import { sanitizeOpaqueHeaderValue, sanitizeUserAgent } from "@/lib/sanitize";

export const PVP_CLIENT_SECRET_REGEX = /^[A-Za-z0-9_-]{32,128}$/;

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

export function normalizePvpClientSecret(secret: string) {
  const normalized = sanitizeOpaqueHeaderValue(secret, 128);
  if (!PVP_CLIENT_SECRET_REGEX.test(normalized)) {
    throw new Error("Invalid PvP client secret");
  }
  return normalized;
}

export function hashPvpFingerprint(params: { userAgent: string | null | undefined; clientSecret: string }) {
  const clientSecret = normalizePvpClientSecret(params.clientSecret);
  const userAgent = sanitizeUserAgent(params.userAgent);

  return crypto.createHash("sha256").update(`${userAgent}\n${clientSecret}`).digest("hex");
}

export function getPvpWsTokenTtlSeconds() {
  return Math.max(60, Math.min(15 * 60, envInt("PVP_WS_TOKEN_TTL_SECONDS", 15 * 60)));
}

export function getPvpWsTokenRefreshWindowSeconds() {
  const ttlSeconds = getPvpWsTokenTtlSeconds();
  return Math.max(30, Math.min(ttlSeconds - 30, envInt("PVP_WS_TOKEN_REFRESH_WINDOW_SECONDS", 120)));
}
