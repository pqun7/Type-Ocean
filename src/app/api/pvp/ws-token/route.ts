export const runtime = "nodejs";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { pvpRatings, users } from "@/db/schema";
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

// Serializes the DB schema probe so concurrent requests don't race to test
// for the pvpWsTokenVersion / pvpWsTokensValidAfter columns on a fresh process.
type WsTokenColumnsCheckState = { hasColumns: boolean; checkedAt: number };
let _wsTokenColumnsState: WsTokenColumnsCheckState | null = null;
let _wsTokenColumnsInflight: Promise<boolean> | null = null;
let hasLoggedMissingPvpWsTokenColumnsWarning = false;
const WS_TOKEN_COLUMNS_RETRY_MS = 60_000;
const PVP_INSECURE_LOCALHOST = process.env.PVP_INSECURE_LOCALHOST === "1";

function createRequestId() {
  return `pvp-ws-token-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createUserLogRef(userId: string) {
  return crypto.createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

function extractClientIp(req: NextRequest) {
  const xForwardedFor = req.headers.get("x-forwarded-for");
  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  const xRealIp = req.headers.get("x-real-ip");

  if (cfConnectingIp) return cfConnectingIp.trim();
  if (xRealIp) return xRealIp.trim();
  if (xForwardedFor) return xForwardedFor.split(",")[0]?.trim() || "anonymous";

  return "anonymous";
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
  if (typeof error !== "object" || error === null) return false;

  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "");

  if (code !== "42703" && !message.toLowerCase().includes("column")) {
    return false;
  }

  return (
    message.includes("pvpWsTokenVersion") ||
    message.includes("pvpWsTokensValidAfter") ||
    message.includes("User.pvpWsTokenVersion") ||
    message.includes("User.pvpWsTokensValidAfter")
  );
}

// Probes whether the new columns exist by running a minimal query.
// PostgreSQL raises error 42703 (undefined_column) at the plan phase, before
// any rows are scanned, so even a query that returns no rows will detect the
// missing column correctly.
async function probeWsTokenColumns(userId: string): Promise<boolean> {
  try {
    await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { pvpWsTokenVersion: true, pvpWsTokensValidAfter: true },
    });
    return true;
  } catch (error) {
    if (isMissingPvpWsTokenColumns(error)) return false;
    throw error;
  }
}

// All concurrent callers share the same in-flight promise so the DB is probed
// only once per process per WS_TOKEN_COLUMNS_RETRY_MS window.
async function resolveWsTokenColumns(userId: string): Promise<boolean> {
  const now = Date.now();
  if (_wsTokenColumnsState !== null && now - _wsTokenColumnsState.checkedAt < WS_TOKEN_COLUMNS_RETRY_MS) {
    return _wsTokenColumnsState.hasColumns;
  }
  if (!_wsTokenColumnsInflight) {
    _wsTokenColumnsInflight = probeWsTokenColumns(userId)
      .then((hasColumns) => {
        _wsTokenColumnsState = { hasColumns, checkedAt: Date.now() };
        return hasColumns;
      })
      .catch((err) => { throw err; })
      .finally(() => { _wsTokenColumnsInflight = null; });
  }
  return _wsTokenColumnsInflight;
}

async function loadWsTokenUser(userId: string): Promise<WsTokenUserRecord | null> {
  const hasColumns = await resolveWsTokenColumns(userId);

  if (!hasColumns) {
    if (!hasLoggedMissingPvpWsTokenColumnsWarning) {
      hasLoggedMissingPvpWsTokenColumnsWarning = true;
      logging.warn("PvP WS token route is using compatibility fallback because DB columns are missing", {
        route: "/api/pvp/ws-token",
        migrationHint: "Run database migrations to add pvpWsTokenVersion and pvpWsTokensValidAfter",
        userRef: createUserLogRef(userId),
      });
    }

    const fallbackUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        username: true,
      },
      with: {
        profile: {
          columns: {
            avatar: true,
          },
        },
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

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      username: true,
      pvpWsTokenVersion: true,
      pvpWsTokensValidAfter: true,
    },
    with: {
      profile: {
        columns: {
          avatar: true,
        },
      },
    },
  });

  if (!user) return null;

  return {
    username: user.username,
    profile: user.profile,
    pvpWsTokenVersion: user.pvpWsTokenVersion ?? 0,
    pvpWsTokensValidAfter: user.pvpWsTokensValidAfter ?? new Date(),
  };
}

export async function GET(req: NextRequest) {
  const requestId = createRequestId();

  // Guard: PVP_INSECURE_LOCALHOST must never be enabled in a real deployed
  // production environment. Allow it when the ws target is localhost so that
  // `npm run start` + `npm run pvp:gateway:start` works for local testing.
  const pvpWsUrlForGuard = process.env.NEXT_PUBLIC_PVP_WS_URL ?? "";
  const isLocalWsTarget = /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(pvpWsUrlForGuard);
  if (PVP_INSECURE_LOCALHOST && process.env.NODE_ENV === "production" && !isLocalWsTarget) {
    return NextResponse.json(
      { error: "PVP_INSECURE_LOCALHOST=1 is not allowed in production" },
      { status: 500 }
    );
  }

  try {
    logging.info("PvP WS token request started", {
      requestId,
      route: "/api/pvp/ws-token",
      operation: "request_start",
    });

    const userId = await authorizeRequest(req);
    if (!userId) {
      incrementSecurityMetric("api_auth_rejected", { route: "/api/pvp/ws-token", method: "GET" });
      logging.warn("PvP WS token request unauthorized", { requestId, route: "/api/pvp/ws-token" });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use a user-scoped key (plus client IP) so localhost/proxy-shared IPs do not
    // cross-throttle authenticated users during reconnect bursts.
    const rateLimitIdentifier = `pvp-ws-token:${userId}:${extractClientIp(req)}`;
    const rateLimit = await rateLimiter.applyRateLimit(rateLimitIdentifier, "/api/pvp/ws-token:GET");
    if (!rateLimit.allowed) {
      incrementSecurityMetric("api_rate_limit_rejected", { route: "/api/pvp/ws-token", method: "GET" });
      logging.warn("PvP WS token request rate limited", {
        requestId,
        route: "/api/pvp/ws-token",
        userRef: createUserLogRef(userId),
      });
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: rateLimit.headers });
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

    // Reject accounts without a username (registration incomplete).
    if (!user?.username) {
      incrementSecurityMetric("api_validation_failed", { route: "/api/pvp/ws-token", reason: "incomplete_profile" });
      logging.warn("PvP WS token request rejected: user missing or has no username", {
        requestId,
        route: "/api/pvp/ws-token",
        userRef: createUserLogRef(userId),
      });
      return NextResponse.json(
        { error: "PvP requires a complete profile" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    await db.insert(pvpRatings).values({ userId }).onConflictDoNothing({ target: pvpRatings.userId });

    const pvpRatingRows = await db
      .select({ rating: pvpRatings.rating, deviation: pvpRatings.deviation })
      .from(pvpRatings)
      .where(eq(pvpRatings.userId, userId))
      .limit(1);

    const pvpRating = pvpRatingRows[0] ?? { rating: 1500, deviation: 350 };

    const fingerprint = hashPvpFingerprint({
      userAgent: req.headers.get("user-agent"),
      clientSecret: clientSecretResult.data,
    });

    const ttlSeconds = getPvpWsTokenTtlSeconds();
    const refreshWindowSeconds = getPvpWsTokenRefreshWindowSeconds();
    const { token, expiresAt } = await mintPvpWsToken(
      {
        sub: userId,
        username: user.username,
        avatar: user.profile?.avatar ?? null,
        pvpRating: pvpRating.rating,
        pvpDeviation: pvpRating.deviation,
        fingerprint,
        tokenVersion: user.pvpWsTokenVersion ?? 0,
        tokensValidAfter: user.pvpWsTokensValidAfter ?? new Date(),
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
