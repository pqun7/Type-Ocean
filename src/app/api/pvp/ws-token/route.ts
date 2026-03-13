export const runtime = "nodejs";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import prisma from "@/features/auth/lib/db";
import { authorizeRequest } from "@/app/api/shared.server";
import { logging } from "@/log/ServerLogger";
import { mintPvpWsToken } from "@/features/pvp/server/ws-token";
import { incrementSecurityMetric } from "@/lib/security-metrics";
import {
  getPvpWsTokenRefreshWindowSeconds,
  getPvpWsTokenTtlSeconds,
  hashPvpFingerprint,
} from "@/lib/pvp/fingerprint";
import { PvpClientSecretHeaderSchema } from "@/lib/validation/pvp-api-schemas";
import { rateLimiter } from "@/lib/rate-limiter";

type WsTokenUserRecord = {
  username: string;
  profile: {
    avatar: string | null;
  } | null;
  pvpWsTokenVersion: number;
  pvpWsTokensValidAfter: Date;
};

let hasPvpWsTokenVersionColumns: boolean | null = null;
let hasLoggedMissingPvpWsTokenColumnsWarning = false;
let wsTokenColumnsLastCheckedAt = 0;
const WS_TOKEN_COLUMNS_RETRY_MS = 60_000;
const PVP_INSECURE_LOCALHOST = process.env.PVP_INSECURE_LOCALHOST === "1";

function createRequestId() {
  return `pvp-ws-token-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createUserLogRef(userId: string) {
  return crypto.createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

function isLocalhostHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isAllowedInsecureLocalWsUrl(wsUrl: string) {
  if (!PVP_INSECURE_LOCALHOST) return false;

  try {
    const parsed = new URL(wsUrl);
    return parsed.protocol === "ws:" && isLocalhostHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isMissingPvpWsTokenColumns(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2022") return false;

  const column = String(error.meta?.column ?? "");
  return column.includes("User.pvpWsTokenVersion") || column.includes("User.pvpWsTokensValidAfter");
}

async function loadWsTokenUser(userId: string): Promise<WsTokenUserRecord | null> {
  if (hasPvpWsTokenVersionColumns === false && Date.now() - wsTokenColumnsLastCheckedAt < WS_TOKEN_COLUMNS_RETRY_MS) {
    const fallbackUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
        profile: { select: { avatar: true } },
      },
    });

    if (!fallbackUser) return null;

    return {
      username: fallbackUser.username,
      profile: fallbackUser.profile,
      pvpWsTokenVersion: 0,
      pvpWsTokensValidAfter: new Date(),
    };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
        pvpWsTokenVersion: true,
        pvpWsTokensValidAfter: true,
        profile: { select: { avatar: true } },
      },
    });

    hasPvpWsTokenVersionColumns = true;
    wsTokenColumnsLastCheckedAt = Date.now();

    if (!user) return null;

    return {
      username: user.username,
      profile: user.profile,
      pvpWsTokenVersion: user.pvpWsTokenVersion ?? 0,
      pvpWsTokensValidAfter: user.pvpWsTokensValidAfter ?? new Date(),
    };
  } catch (error) {
    if (!isMissingPvpWsTokenColumns(error)) {
      throw error;
    }

    if (!hasLoggedMissingPvpWsTokenColumnsWarning) {
      hasLoggedMissingPvpWsTokenColumnsWarning = true;
      logging.warn("PvP WS token route is using compatibility fallback because DB columns are missing", {
        route: "/api/pvp/ws-token",
        migrationHint: "Run Prisma migrations to add pvpWsTokenVersion and pvpWsTokensValidAfter",
        userRef: createUserLogRef(userId),
      });
    }

    hasPvpWsTokenVersionColumns = false;
  wsTokenColumnsLastCheckedAt = Date.now();

    const fallbackUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
        profile: { select: { avatar: true } },
      },
    });

    if (!fallbackUser) return null;

    return {
      username: fallbackUser.username,
      profile: fallbackUser.profile,
      pvpWsTokenVersion: 0,
      pvpWsTokensValidAfter: new Date(),
    };
  }
}

export async function GET(req: NextRequest) {
  const requestId = createRequestId();

  try {
    logging.info("PvP WS token request started", {
      requestId,
      route: "/api/pvp/ws-token",
      operation: "request_start",
    });

    const rateLimit = await rateLimiter.applyRateLimit(req, "/api/pvp/ws-token:GET");
    if (!rateLimit.allowed) {
      incrementSecurityMetric("api_rate_limit_rejected", { route: "/api/pvp/ws-token", method: "GET" });
      logging.warn("PvP WS token request rate limited", {
        requestId,
        route: "/api/pvp/ws-token",
      });
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
    }

    const userId = await authorizeRequest(req);
    if (!userId) {
      incrementSecurityMetric("api_auth_rejected", { route: "/api/pvp/ws-token", method: "GET" });
      logging.warn("PvP WS token request unauthorized", { requestId, route: "/api/pvp/ws-token" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientSecretResult = PvpClientSecretHeaderSchema.safeParse(req.headers.get("x-pvp-client-secret") ?? "");
    if (!clientSecretResult.success) {
      incrementSecurityMetric("api_validation_failed", { route: "/api/pvp/ws-token", reason: "client_secret" });
      logging.warn("PvP WS token request failed validation", {
        requestId,
        route: "/api/pvp/ws-token",
        userRef: createUserLogRef(userId),
        reason: "client_secret",
      });
      return NextResponse.json({ error: "Invalid PvP client secret" }, { status: 400, headers: rateLimit.headers });
    }

    const wsUrl = process.env.NEXT_PUBLIC_PVP_WS_URL ?? null;
    if (!wsUrl) {
      logging.error("PvP WS token request missing websocket URL configuration", new Error("Missing NEXT_PUBLIC_PVP_WS_URL"), {
        requestId,
        route: "/api/pvp/ws-token",
        userRef: createUserLogRef(userId),
      });
      return NextResponse.json({ error: "Missing NEXT_PUBLIC_PVP_WS_URL" }, { status: 500, headers: rateLimit.headers });
    }

    const enforceWss = process.env.NODE_ENV === "production" && !isAllowedInsecureLocalWsUrl(wsUrl);
    if (enforceWss && !wsUrl.startsWith("wss://")) {
      incrementSecurityMetric("api_transport_rejected", { route: "/api/pvp/ws-token", reason: "insecure_ws_url" });
      logging.error("PvP WS token request rejected due to insecure websocket URL", new Error("Insecure websocket URL"), {
        requestId,
        route: "/api/pvp/ws-token",
        userRef: createUserLogRef(userId),
      });
      return NextResponse.json({ error: "PvP websocket URL must use WSS in production" }, { status: 500, headers: rateLimit.headers });
    }

    const user = await loadWsTokenUser(userId);

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

    logging.info("PvP WS token issued successfully", {
      requestId,
      route: "/api/pvp/ws-token",
      userRef: createUserLogRef(userId),
      expiresAt,
      refreshWindowSeconds,
      operation: "request_complete",
    });

    return NextResponse.json(
      {
        token,
        expiresAt,
        refreshAfter: Math.max(Math.floor(Date.now() / 1000) + 30, expiresAt - refreshWindowSeconds),
        wsUrl,
      },
      { headers: rateLimit.headers }
    );
  } catch (error) {
    logging.error("PvP WS token request failed", error, {
      requestId,
      route: "/api/pvp/ws-token",
      operation: "request_error",
    });
    return NextResponse.json({ error: "Failed to issue PvP token" }, { status: 500 });
  }
}
