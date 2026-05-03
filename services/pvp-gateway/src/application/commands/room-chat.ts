/**
 * @module application/commands/room-chat
 * Handles LOBBY_CHAT — member sends a chat message to all room participants.
 * Messages are ephemeral (broadcast only, not persisted in the DB).
 */

import { sanitizeRoomCode } from "../../../../../src/lib/sanitize";
import { broadcastRoom } from "../../presentation/ws-sender";
import { send } from "../../presentation/ws-sender";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";

/** Strip tags and control characters from chat text. */
function sanitizeChatText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "") // strip HTML tags
    .replace(/[\x00-\x1F\x7F]/g, "") // strip control chars
    .trim()
    .slice(0, 400);
}

export async function handleRoomChat(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "LOBBY_CHAT" }>,
  deps: GatewayDeps,
): Promise<void> {
  if (!ws.user) {
    send(ws, "ERROR", { message: "Unauthenticated" }, deps);
    return;
  }

  const code = sanitizeRoomCode(msg.payload?.roomCode ?? ws.roomCode ?? "");
  if (!code) {
    send(ws, "ERROR", { message: "Not in a room" }, deps);
    return;
  }

  const text = sanitizeChatText(msg.payload.text ?? "");
  if (!text) {
    send(ws, "ERROR", { message: "Empty message" }, deps);
    return;
  }

  broadcastRoom(
    code,
    "LOBBY_CHAT",
    {
      roomCode: code,
      userId: ws.user.userId,
      username: ws.user.username,
      text,
      ts: Date.now(),
    },
    deps,
  );
}
