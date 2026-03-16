import { jwtVerify } from "jose";
import { eq } from "drizzle-orm";

import { incrementGatewayMetric } from "./metrics";
import type { GatewayDb } from "./gateway-db";
import { users } from "@/src/db/schema";
import { hashPvpFingerprint } from "../../../src/lib/pvp/fingerprint";
import { sanitizeUserAgent } from "../../../src/lib/sanitize";

export type AuthedUser = {
  userId: string;
  username: string;
  avatar: string | null;
  pvpRating: number;
  pvpDeviation: number;
};

export type WsAuthContext = AuthedUser & {
  tokenVersion: number;
  validAfter: number;
  issuedAt: number;
};

type VerifyWsTokenFastParams = {
  clientSecret: string;
  userAgent?: string | null;
  expectedUserId?: string;
};

type VerifyWsTokenStrictParams = VerifyWsTokenFastParams & {
  prisma: GatewayDb;
};

function getSecretKey() {
  const raw = process.env.PVP_GATEWAY_JWT_SECRET;
  if (!raw) throw new Error("Missing PVP_GATEWAY_JWT_SECRET");
  return new TextEncoder().encode(raw);
}

function parseAndVerifyToken(token: string, params: VerifyWsTokenFastParams): Promise<WsAuthContext> {
  return jwtVerify(token, getSecretKey(), {
    algorithms: ["HS256"],
  }).then(({ payload }) => {
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) throw new Error("Invalid token (missing sub)");
    if (params.expectedUserId && params.expectedUserId !== sub) {
      incrementGatewayMetric("ws_auth_rejected", { reason: "subject_mismatch" });
      throw new Error("Invalid token subject");
    }

    const fingerprint = typeof (payload as { fp?: unknown }).fp === "string" ? (payload as { fp: string }).fp : null;
    if (!fingerprint) throw new Error("Invalid token (missing fingerprint)");

    const expectedFingerprint = hashPvpFingerprint({
      userAgent: sanitizeUserAgent(params.userAgent),
      clientSecret: params.clientSecret,
    });

    if (fingerprint !== expectedFingerprint) {
      incrementGatewayMetric("ws_auth_rejected", { reason: "fingerprint_mismatch" });
      throw new Error("Invalid websocket fingerprint");
    }

    const tokenVersionRaw = Number((payload as { tv?: unknown }).tv);
    const validAfterRaw = Number((payload as { va?: unknown }).va);
    const issuedAt = typeof payload.iat === "number" ? Math.trunc(payload.iat) : null;
    const tokenVersion = Number.isFinite(tokenVersionRaw) ? Math.trunc(tokenVersionRaw) : null;
    const validAfter = Number.isFinite(validAfterRaw) ? Math.trunc(validAfterRaw) : null;
    if (tokenVersion == null || validAfter == null || issuedAt == null) {
      throw new Error("Invalid token security claims");
    }

    const username = typeof (payload as { username?: unknown }).username === "string" ? (payload as { username: string }).username : "user";
    const avatar = typeof (payload as { avatar?: unknown }).avatar === "string" ? (payload as { avatar: string }).avatar : null;
    const pvpRating = Number.isFinite((payload as { pvpRating?: unknown }).pvpRating)
      ? Math.round(Number((payload as { pvpRating: number }).pvpRating))
      : 1500;
    const pvpDeviation = Number.isFinite((payload as { pvpDeviation?: unknown }).pvpDeviation)
      ? Math.round(Number((payload as { pvpDeviation: number }).pvpDeviation))
      : 350;

    return {
      userId: sub,
      username,
      avatar,
      pvpRating,
      pvpDeviation,
      tokenVersion,
      validAfter,
      issuedAt,
    };
  });
}

export async function verifyWsTokenFast(token: string, params: VerifyWsTokenFastParams): Promise<WsAuthContext> {
  return parseAndVerifyToken(token, params);
}

export async function assertWsTokenState(prisma: GatewayDb, context: WsAuthContext): Promise<void> {
  const rows = await prisma
    .select({
      banned: users.banned,
      pvpWsTokenVersion: users.pvpWsTokenVersion,
      pvpWsTokensValidAfter: users.pvpWsTokensValidAfter,
    })
    .from(users)
    .where(eq(users.id, context.userId))
    .limit(1);

  const tokenState = rows[0] ?? null;
  if (!tokenState) throw new Error("User not found");
  if (tokenState.banned) {
    incrementGatewayMetric("ws_auth_rejected", { reason: "banned_user" });
    throw new Error("User is banned");
  }
  if (tokenState.pvpWsTokenVersion !== context.tokenVersion) {
    incrementGatewayMetric("ws_auth_rejected", { reason: "version_mismatch" });
    throw new Error("Websocket token revoked");
  }
  if (
    context.issuedAt < Math.floor(tokenState.pvpWsTokensValidAfter.getTime() / 1000) ||
    context.issuedAt < context.validAfter
  ) {
    incrementGatewayMetric("ws_auth_rejected", { reason: "valid_after_mismatch" });
    throw new Error("Websocket token expired by policy");
  }
}

export async function verifyWsTokenStrict(token: string, params: VerifyWsTokenStrictParams): Promise<WsAuthContext> {
  const context = await parseAndVerifyToken(token, params);
  await assertWsTokenState(params.prisma, context);
  return context;
}
