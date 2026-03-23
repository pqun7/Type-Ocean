/**
 * @module application/commands/queue-leave
 * Handles QUEUE_LEAVE — removes the user from the ranked matchmaking queue.
 */

import { send } from "../../presentation/ws-sender";
import { loadIdempotencyHit, storeIdempotencyHit } from "../match-helpers";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";

export async function handleQueueLeave(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "QUEUE_LEAVE" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  const userId = ws.user!.userId;

  deps.state.removeFromQueue(userId);
  deps.state.clearQueueTimeout(userId);
  await deps.queueAdapter.leave(userId);

  await storeIdempotencyHit({
    redis: deps.redisBus?.redis ?? null,
    store: deps.idempotencyStore,
    key: idempotency?.key,
    messageType: msg.type,
    value: { response: { type: "QUEUE_STATUS", payload: { status: "IDLE" } } },
  });

  send(ws, "QUEUE_STATUS", { status: "IDLE" }, deps);
}
