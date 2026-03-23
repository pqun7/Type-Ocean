/**
 * @module application/commands/rematch-response
 * Handles REMATCH_RESPONSE — accept or decline a rematch offer.
 */

import { sendToUser } from "../../presentation/ws-sender";
import { send } from "../../presentation/ws-sender";
import { gatewayLogInfo } from "../../shared/logger";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { LocalMatch } from "../../shared/types";

export async function handleRematchResponse(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "REMATCH_RESPONSE" }>,
  deps: GatewayDeps,
): Promise<void> {
  const match = deps.state.matches.get(msg.payload.matchId) as LocalMatch | undefined;
  if (!match) {
    send(ws, "ERROR", { message: "Unknown match" }, deps);
    return;
  }

  // Re-send MATCH_FOUND if a rematch was already created
  if (match.rematchMatchId) {
    const rematch = deps.state.matches.get(match.rematchMatchId) as LocalMatch | undefined;
    if (rematch) {
      sendToUser(ws.user!.userId, "MATCH_FOUND", {
        matchId: rematch.matchId,
        textSnapshot: rematch.textSnapshot,
        textId: rematch.textId,
        inputNonce: rematch.inputNonce,
        serverStartAt: new Date(rematch.serverStartAtMs).toISOString(),
        players: Array.from(rematch.participants.values()).map((p) => ({
          userId: p.userId,
          username: p.username,
          avatar: p.avatar,
          slot: p.slot,
        })),
      }, deps);
    }
    return;
  }

  if (match.status !== "FINISHED") {
    send(ws, "ERROR", { message: "Match not finished" }, deps);
    return;
  }
  if (match.roomCode !== null) {
    send(ws, "ERROR", { message: "Rematch not supported for rooms" }, deps);
    return;
  }

  const participants = Array.from(match.participants.values());
  if (participants.length !== 2) {
    send(ws, "ERROR", { message: "Rematch only supported for 1v1" }, deps);
    return;
  }

  const meId = ws.user!.userId;
  const me = match.participants.get(meId);
  if (!me) {
    send(ws, "ERROR", { message: "Not a participant" }, deps);
    return;
  }

  const other = participants.find((p) => p.userId !== meId);
  if (!other) {
    send(ws, "ERROR", { message: "Opponent not found" }, deps);
    return;
  }

  // Declined
  if (!msg.payload.accept) {
    deps.rematchAcceptedByMatchId.delete(match.matchId);
    deps.rematchAcceptedTouchedAtByMatchId.delete(match.matchId);
    sendToUser(other.userId, "REMATCH_DECLINED", { matchId: match.matchId, byUserId: meId, reason: "DECLINED" }, deps);
    sendToUser(meId, "REMATCH_DECLINED", { matchId: match.matchId, byUserId: meId, reason: "DECLINED" }, deps);
    return;
  }

  let accepted = deps.rematchAcceptedByMatchId.get(match.matchId);
  if (!accepted) {
    accepted = new Set<string>();
    deps.rematchAcceptedByMatchId.set(match.matchId, accepted);
  }
  deps.rematchAcceptedTouchedAtByMatchId.set(match.matchId, Date.now());

  accepted.add(meId);
  const acceptedUserIds = Array.from(accepted);
  sendToUser(meId, "REMATCH_STATUS", { matchId: match.matchId, acceptedUserIds }, deps);
  sendToUser(other.userId, "REMATCH_STATUS", { matchId: match.matchId, acceptedUserIds }, deps);

  if (accepted.size >= 2) {
    deps.rematchAcceptedByMatchId.delete(match.matchId);
    deps.rematchAcceptedTouchedAtByMatchId.delete(match.matchId);

    const [aConn, bConn] = await Promise.all([
      deps.loadConnectionUser(meId),
      deps.loadConnectionUser(other.userId),
    ]);

    await deps.createLockedHumanRematch({
      sourceMatchId: match.matchId,
      users: [
        { ...aConn, slot: me.slot },
        { ...bConn, slot: other.slot },
      ],
      persistUserIds: [meId, other.userId],
    });

    gatewayLogInfo("Rematch accepted by both players", { matchId: match.matchId });
  } else {
    sendToUser(other.userId, "REMATCH_OFFER", { matchId: match.matchId, fromUserId: meId }, deps);
  }
}
