/**
 * @module application/commands/auth-refresh
 * Handles AUTH_REFRESH — re-validates the JWT and updates ws.user.
 */

import type { IncomingMessage } from "http";
import { verifyWsTokenStrict } from "../../auth";
import { sanitizeUserAgent } from "../../../../../src/lib/sanitize";
import { gatewayLogDebug } from "../../shared/logger";
import { send } from "../../presentation/ws-sender";
import { getPvpRankInfo } from "../../../../../src/features/pvp/rank";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import { loadGatewayLongTermStats } from "../load-long-term-stats";

export async function handleAuthRefresh(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "AUTH_REFRESH" }>,
  req: IncomingMessage,
  deps: GatewayDeps,
): Promise<void> {
  if (!ws.user) {
    send(ws, "ERROR", { message: "Unauthenticated" }, deps);
    return;
  }

  const refreshed = await verifyWsTokenStrict(msg.payload.token, {
    db: deps.db,
    clientSecret: msg.payload.clientSecret,
    userAgent: sanitizeUserAgent(req.headers["user-agent"] ?? null),
    expectedUserId: ws.user.userId,
  });

  ws.user = {
    ...ws.user,
    username: refreshed.username,
    avatar: refreshed.avatar,
    pvpRating: refreshed.pvpRating,
    pvpDeviation: refreshed.pvpDeviation,
    tokenVersion: refreshed.tokenVersion,
    validAfter: refreshed.validAfter,
    issuedAt: refreshed.issuedAt,
  };

  await deps.markOnline(ws.user.userId);
  gatewayLogDebug("Websocket auth refresh completed", { userId: ws.user.userId });

  const ttlSeconds = Math.max(1, parseInt(process.env.PVP_WS_TOKEN_TTL_SECONDS ?? "900", 10) || 900);
  const longTermStats = await loadGatewayLongTermStats({
    db: deps.db,
    redisBus: deps.redisBus,
    userId: ws.user.userId,
    logContext: "AUTH_REFRESH",
  });

  send(
    ws,
    "AUTH_REFRESH_OK",
    {
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
      user: {
        userId: ws.user.userId,
        username: ws.user.username,
        avatar: ws.user.avatar,
        rating: ws.user.pvpRating,
        rankTier: getPvpRankInfo(ws.user.pvpRating).tier,
        averageWpm: longTermStats.averageWpm,
        bestWpm: longTermStats.bestWpm,
        avgAcc: longTermStats.avgAcc,
      },
    },
    deps,
  );
}
