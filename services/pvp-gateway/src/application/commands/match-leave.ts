/**
 * @module application/commands/match-leave
 * Handles MATCH_LEAVE — gracefully leaves an active or pre-start match.
 */

import { isTerminalPvpMatchStatus } from "../../../../../src/features/pvp/server/match-access";
import { withMatchLock } from "../match-helpers";
import { finalizeMatchByDisconnectForfeit } from "../disconnect-handler";
import { abortMatchLifecycle } from "../abort-match";
import { send } from "../../presentation/ws-sender";
import { toMatchId } from "../../shared/branded-ids";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { LocalMatch } from "../../shared/types";

export async function handleMatchLeave(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "MATCH_LEAVE" }>,
  deps: GatewayDeps,
): Promise<void> {
  const userId = ws.user!.userId;
  const match = deps.state.matches.get(msg.payload.matchId) as LocalMatch | undefined;

  if (!match) {
    send(ws, "ERROR", { message: "Unknown match" }, deps);
    return;
  }

  if (!match.participants.has(userId)) {
    send(ws, "ERROR", { message: "Not a participant" }, deps);
    return;
  }

  deps.clearDisconnectForfeitTimer(match.matchId, userId);
  deps.releaseMatchSession(ws);
  ws.matchId = undefined;

  if (match.participants.size === 2 && !isTerminalPvpMatchStatus(match.status)) {
    if (match.state === "live") {
      await withMatchLock(toMatchId(match.matchId), () =>
        finalizeMatchByDisconnectForfeit({
          matchId: match.matchId,
          forfeitedUserId: userId,
          deps,
        }), deps);
    } else {
      await withMatchLock(toMatchId(match.matchId), () =>
        abortMatchLifecycle({
          matchId: match.matchId,
          reasonCode: "no_show",
          reasonMessage: "The match was cancelled because a player left before it started.",
          deps,
        }), deps);
    }
  }
}
