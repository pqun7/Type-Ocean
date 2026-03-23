/**
 * @module application/commands/hello
 * Handles the initial HELLO handshake — authenticates the WS connection.
 */

import crypto from "crypto";
import type { IncomingMessage } from "http";
import { verifyWsTokenFast } from "../../auth";
import { sanitizeUserAgent } from "../../../../../src/lib/sanitize";
import {
  decodeJwtPayloadUnsafe,
  mapHelloAuthFailure,
  PvpClientVisibleError,
} from "../../shared/errors";
import { gatewayLogInfo, gatewayLogWarn } from "../../shared/logger";
import { send } from "../../presentation/ws-sender";
import type { WsAuthContext } from "../../auth";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";

// ---------------------------------------------------------------------------
// Bypass-auth context builder (used only when TEST_BYPASS is set)
// ---------------------------------------------------------------------------

function buildBypassWsAuthContext(token: string, connectionId: string): WsAuthContext {
  const decoded = decodeJwtPayloadUnsafe(token);
  const fallbackSub = `test-bypass-${crypto.createHash("sha256").update(`${token}:${connectionId}`).digest("hex").slice(0, 24)}`;

  const userId = decoded !== null && typeof decoded.sub === "string" && decoded.sub.trim().length > 0
    ? decoded.sub
    : fallbackSub;
  const username = decoded !== null && typeof decoded.username === "string" && decoded.username.trim().length > 0
    ? decoded.username
    : "test-bypass-user";
  const avatar = decoded !== null && typeof decoded.avatar === "string" ? decoded.avatar : null;
  const pvpRating = decoded !== null && Number.isFinite(decoded.pvpRating) ? Math.round(Number(decoded.pvpRating)) : 1500;
  const pvpDeviation = decoded !== null && Number.isFinite(decoded.pvpDeviation) ? Math.round(Number(decoded.pvpDeviation)) : 350;
  const tokenVersion = decoded !== null && Number.isFinite(decoded.tv) ? Math.trunc(Number(decoded.tv)) : 1;
  const validAfter = decoded !== null && Number.isFinite(decoded.va) ? Math.trunc(Number(decoded.va)) : 0;
  const issuedAt = decoded !== null && Number.isFinite(decoded.iat) ? Math.trunc(Number(decoded.iat)) : Math.floor(Date.now() / 1000);

  return { userId, username, avatar, pvpRating, pvpDeviation, tokenVersion, validAfter, issuedAt };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleHello(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "HELLO" }>,
  req: IncomingMessage,
  deps: GatewayDeps,
): Promise<void> {
  let authed: WsAuthContext;

  if (deps.testBypass) {
    authed = buildBypassWsAuthContext(msg.payload.token, ws.connectionId ?? crypto.randomUUID());
    ws.authBypass = true;
    gatewayLogWarn("Accepted HELLO using PVP_TEST_BYPASS_AUTH in non-production", {
      connectionId: ws.connectionId,
      userId: authed.userId,
      ip: ws.ip ?? "unknown",
    });
  } else {
    try {
      authed = await verifyWsTokenFast(msg.payload.token, {
        clientSecret: msg.payload.clientSecret,
        userAgent: sanitizeUserAgent(req.headers["user-agent"] ?? null),
      });
    } catch (authError) {
      const mapped = mapHelloAuthFailure(authError);
      gatewayLogWarn("Rejected HELLO authentication", {
        code: mapped.code,
        reason: authError instanceof Error ? authError.message : "unknown",
        requestId: msg.requestId,
        connectionId: ws.connectionId,
        ip: ws.ip ?? "unknown",
      });
      throw new PvpClientVisibleError({
        ...mapped,
        details: {
          requestId: msg.requestId,
          phase: "hello_auth",
        },
      });
    }
  }

  ws.user = {
    userId: authed.userId,
    username: authed.username,
    avatar: authed.avatar,
    pvpRating: authed.pvpRating,
    pvpDeviation: authed.pvpDeviation,
    tokenVersion: authed.tokenVersion,
    validAfter: authed.validAfter,
    issuedAt: authed.issuedAt,
  };
  deps.gatewayMetrics?.incrementWsHandshake("success");

  gatewayLogInfo("Websocket client authenticated", {
    userId: ws.user.userId,
    ip: ws.ip ?? "unknown",
  });

  deps.matchCache?.addUserSocket(ws);
  await deps.markOnline(ws.user.userId);

  if (deps.redisBus?.redis) {
    ws.presenceInterval = setInterval(() => {
      if (!ws.user) return;
      void deps.markOnline(ws.user.userId);
    }, deps.presenceRefreshMs);
  }

  send(ws, "HELLO_OK", {
    user: {
      userId: ws.user.userId,
      username: ws.user.username,
      avatar: ws.user.avatar,
    },
  }, deps);
}
