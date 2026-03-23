/**
 * @module application/commands/finish
 * Handles FINISH — explicit match-completed signal from a client.
 *
 * Marks the participant's `finishedAt` timestamp if not already set,
 * persists final stats to the DB, stores idempotency, and attempts
 * to finalize the match if both players are done.
 */

import { and, eq } from "drizzle-orm";

import { pvpParticipants } from "../../../../../src/db/schema";
import { storeIdempotencyHit } from "../match-helpers";
import { finalizeMatchIfComplete } from "../finalize-match";
import { send } from "../../presentation/ws-sender";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { LocalMatch } from "../../shared/types";
import type { loadIdempotencyHit } from "../match-helpers";

export async function handleFinish(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "FINISH" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  const match = deps.state.matches.get(msg.payload.matchId) as LocalMatch | undefined;
  if (!match) {
    send(ws, "ERROR", { message: "Unknown match" }, deps);
    return;
  }

  const participant = match.participants.get(ws.user!.userId);
  if (!participant) {
    send(ws, "ERROR", { message: "Not joined" }, deps);
    return;
  }

  if (participant.finishedAt == null) {
    participant.finishedAt = Date.now();
  }

  await deps.db
    .update(pvpParticipants)
    .set({
      finalWpm: participant.wpm,
      finalAccuracy: participant.accuracy,
      finalErrors: participant.errors,
      timeSpentSec: Math.max(0, Math.floor((participant.finishedAt - match.serverStartAtMs) / 1000)),
      completedAt: new Date(participant.finishedAt),
    })
    .where(and(eq(pvpParticipants.matchId, match.matchId), eq(pvpParticipants.userId, participant.userId)));

  await storeIdempotencyHit({
    redis: deps.redisBus?.redis ?? null,
    store: deps.idempotencyStore,
    key: idempotency?.key,
    messageType: msg.type,
    value: { processedSeq: participant.seq },
  });

  await finalizeMatchIfComplete({ matchId: match.matchId, deps });
}
