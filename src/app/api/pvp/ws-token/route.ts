export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/features/auth/lib/db";
import { authorizeRequest } from "@/app/api/shared.server";
import { mintPvpWsToken } from "@/features/pvp/server/ws-token";
import { incrementSecurityMetric } from "@/lib/security-metrics";
import {
  getPvpWsTokenRefreshWindowSeconds,
  getPvpWsTokenTtlSeconds,
  hashPvpFingerprint,
} from "@/lib/pvp/fingerprint";
import { PvpClientSecretHeaderSchema } from "@/lib/validation/pvp-api-schemas";
import { rateLimiter } from "@/lib/rate-limiter";

export async function GET(req: NextRequest) {
  const rateLimit = await rateLimiter.applyRateLimit(req, "/api/pvp/ws-token:GET");
  if (!rateLimit.allowed) {
    incrementSecurityMetric("api_rate_limit_rejected", { route: "/api/pvp/ws-token", method: "GET" });
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
  }

  const userId = await authorizeRequest(req);
  if (!userId) {
    incrementSecurityMetric("api_auth_rejected", { route: "/api/pvp/ws-token", method: "GET" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientSecretResult = PvpClientSecretHeaderSchema.safeParse(req.headers.get("x-pvp-client-secret") ?? "");
  if (!clientSecretResult.success) {
    incrementSecurityMetric("api_validation_failed", { route: "/api/pvp/ws-token", reason: "client_secret" });
    return NextResponse.json({ error: "Invalid PvP client secret" }, { status: 400, headers: rateLimit.headers });
  }

  const wsUrl = process.env.NEXT_PUBLIC_PVP_WS_URL ?? null;
  if (!wsUrl) {
    return NextResponse.json({ error: "Missing NEXT_PUBLIC_PVP_WS_URL" }, { status: 500, headers: rateLimit.headers });
  }

  if (process.env.NODE_ENV === "production" && !wsUrl.startsWith("wss://")) {
    incrementSecurityMetric("api_transport_rejected", { route: "/api/pvp/ws-token", reason: "insecure_ws_url" });
    return NextResponse.json({ error: "PvP websocket URL must use WSS in production" }, { status: 500, headers: rateLimit.headers });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      pvpWsTokenVersion: true,
      pvpWsTokensValidAfter: true,
      profile: { select: { avatar: true } },
    },
  });

  const pvpRating = await prisma.pvpRating.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { rating: true, deviation: true },
  });

  const fingerprint = hashPvpFingerprint({
    userAgent: req.headers.get("user-agent"),
    clientSecret: clientSecretResult.data,
  });

  const ttlSeconds = getPvpWsTokenTtlSeconds();
  const refreshWindowSeconds = getPvpWsTokenRefreshWindowSeconds();
  const { token, expiresAt } = await mintPvpWsToken(
    {
      sub: userId,
      username: user?.username ?? "user",
      avatar: user?.profile?.avatar ?? null,
      pvpRating: pvpRating.rating,
      pvpDeviation: pvpRating.deviation,
      fingerprint,
      tokenVersion: user?.pvpWsTokenVersion ?? 0,
      tokensValidAfter: user?.pvpWsTokensValidAfter ?? new Date(),
    },
    ttlSeconds
  );

  return NextResponse.json(
    {
      token,
      expiresAt,
      refreshAfter: Math.max(Math.floor(Date.now() / 1000) + 30, expiresAt - refreshWindowSeconds),
      wsUrl,
    },
    { headers: rateLimit.headers }
  );
}
