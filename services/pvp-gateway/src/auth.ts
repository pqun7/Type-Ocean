import type { PrismaClient } from "@prisma/client";
import { jwtVerify } from "jose";

import { incrementGatewayMetric } from "./metrics";
import { hashPvpFingerprint } from "../../../src/lib/pvp/fingerprint";
import { sanitizeUserAgent } from "../../../src/lib/sanitize";

export type AuthedUser = {
  userId: string;
  username: string;
  avatar: string | null;
  pvpRating: number;
  pvpDeviation: number;
};

type VerifyWsTokenParams = {
  prisma: PrismaClient;
  clientSecret: string;
  userAgent?: string | null;
  expectedUserId?: string;
};

function getSecretKey() {
  const raw = process.env.PVP_GATEWAY_JWT_SECRET;
  if (!raw) throw new Error("Missing PVP_GATEWAY_JWT_SECRET");
  return new TextEncoder().encode(raw);
}

export async function verifyWsToken(token: string, params: VerifyWsTokenParams): Promise<AuthedUser> {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    algorithms: ["HS256"],
  });

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
  const tokenVersion = Number.isFinite(tokenVersionRaw) ? Math.trunc(tokenVersionRaw) : null;
  const validAfter = Number.isFinite(validAfterRaw) ? Math.trunc(validAfterRaw) : null;
  const issuedAt = typeof payload.iat === "number" ? Math.trunc(payload.iat) : null;
  if (tokenVersion == null || validAfter == null || issuedAt == null) {
    throw new Error("Invalid token security claims");
  }

  const tokenState = await params.prisma.user.findUnique({
    where: { id: sub },
    select: {
      pvpWsTokenVersion: true,
      pvpWsTokensValidAfter: true,
    },
  });
  if (!tokenState) throw new Error("User not found");
  if (tokenState.pvpWsTokenVersion !== tokenVersion) {
    incrementGatewayMetric("ws_auth_rejected", { reason: "version_mismatch" });
    throw new Error("Websocket token revoked");
  }
  if (issuedAt < Math.floor(tokenState.pvpWsTokensValidAfter.getTime() / 1000) || issuedAt < validAfter) {
    incrementGatewayMetric("ws_auth_rejected", { reason: "valid_after_mismatch" });
    throw new Error("Websocket token expired by policy");
  }

  const username = typeof (payload as any).username === "string" ? (payload as any).username : "user";
  const avatar = typeof (payload as any).avatar === "string" ? (payload as any).avatar : null;
  const pvpRating = Number.isFinite((payload as any).pvpRating) ? Math.round((payload as any).pvpRating) : 1500;
  const pvpDeviation = Number.isFinite((payload as any).pvpDeviation)
    ? Math.round((payload as any).pvpDeviation)
    : 350;

  return {
    userId: sub,
    username,
    avatar,
    pvpRating,
    pvpDeviation,
  };
}
