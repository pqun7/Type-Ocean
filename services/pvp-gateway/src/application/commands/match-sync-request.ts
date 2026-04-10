/**
 * @module application/commands/match-sync-request
 *
 * Handles MATCH_SYNC_REQUEST — a client-triggered match state reconciliation.
 *
 * ## Purpose
 * When the client's local countdown timer reaches 0 and the match status is
 * still COUNTDOWN (i.e. the activation server-event has not arrived), the
 * client sends this message to ask the gateway to either:
 *  a) Activate the match → transition to LIVE if `serverStartAtMs` has passed.
 *  b) Replay the current MATCH_STATE → so the client can re-sync its display.
 *
 * ## Safety
 * - The requesting user must be an authenticated participant of the match.
 * - Per-socket rate-limit: max 3 requests per match within any 10-second window.
 *   Excess requests are silently dropped.
 */

import { buildMatchStatePayload } from "../../match-sync";
import { send } from "../../presentation/ws-sender";
import { isAiUserId } from "../../shared/errors";
import { gatewayLogDebug, gatewayLogWarn } from "../../shared/logger";

import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { LocalMatch } from "../../shared/types";

// Per-socket rate-limit: allow at most MAX_SYNC_REQUESTS within WINDOW_MS.
const MAX_SYNC_REQUESTS = 3;
const WINDOW_MS = 10_000;

export async function handleMatchSyncRequest(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "MATCH_SYNC_REQUEST" }>,
  deps: GatewayDeps,
): Promise<void> {
  if (!ws.user) return;

  const matchId = msg.payload.matchId;
  const userId = ws.user.userId;

  // -------------------------------------------------------------------------
  // Per-socket rate limiting
  // -------------------------------------------------------------------------
  const nowMs = Date.now();
  if (!ws.matchSyncRequests) {
    ws.matchSyncRequests = { count: 0, windowStartMs: nowMs };
  } else if (nowMs - ws.matchSyncRequests.windowStartMs > WINDOW_MS) {
    ws.matchSyncRequests = { count: 0, windowStartMs: nowMs };
  }

  ws.matchSyncRequests.count += 1;

  if (ws.matchSyncRequests.count > MAX_SYNC_REQUESTS) {
    gatewayLogDebug("MATCH_SYNC_REQUEST rate-limited", { userId, matchId });
    return;
  }

  // -------------------------------------------------------------------------
  // Find the match and validate participation
  // -------------------------------------------------------------------------
  const match = deps.state.matches.get(matchId) as LocalMatch | undefined;
  if (!match) {
    // Match not in-memory yet — client is stale, no action needed.
    return;
  }

  if (!match.participants.has(userId)) {
    gatewayLogWarn("MATCH_SYNC_REQUEST from non-participant", { userId, matchId });
    return;
  }

  // Ignore if match is already in a terminal state.
  if (match.state === "finished" || match.state === "aborted") {
    return;
  }

  // -------------------------------------------------------------------------
  // Attempt countdown activation if the match is still in countdown phase
  // -------------------------------------------------------------------------
  if (match.state === "countdown") {
    const activated = await deps.activateCountdownMatchIfDue(matchId);
    if (activated) {
      // broadcastMatchState will have been called inside activateCountdownMatchIfDue.
      gatewayLogDebug("MATCH_SYNC_REQUEST triggered activation", { userId, matchId });
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Replay current match state to the requesting socket only
  // -------------------------------------------------------------------------
  const payload = buildMatchStatePayload(
    match as unknown as Parameters<typeof buildMatchStatePayload>[0],
  );

  // Only include non-AI participants in the replay log, but always send to
  // the requesting client regardless.
  if (!isAiUserId(userId)) {
    gatewayLogDebug("MATCH_SYNC_REQUEST replaying MATCH_STATE", {
      userId,
      matchId,
      matchState: match.state,
    });
  }

  send(ws, "MATCH_STATE", payload, deps);
}
