import {
  PvpClientMessageSchema as ClientMessageSchema,
  type PvpClientMessage as ClientMessage,
} from "../../../src/lib/validation/ws-schemas";

export type { PvpClientMessage as ClientMessage } from "../../../src/lib/validation/ws-schemas";

export function safeParseClientMessage(raw: string):
  | { success: true; data: ClientMessage }
  | { success: false; error: string } {
  try {
    const parsed = JSON.parse(raw);
    const res = ClientMessageSchema.safeParse(parsed);
    if (res.success) {
      return { success: true, data: res.data };
    }
    return { success: false, error: res.error.issues[0]?.message ?? "Invalid message" };
  } catch {
    return { success: false, error: "Malformed JSON" };
  }
}

export type ServerMessage = {
  type:
    | "HELLO_OK"
    | "AUTH_REFRESH_OK"
    | "QUEUE_STATUS"
    | "ROOM_STATE"
    | "MATCH_FOUND"
    | "MATCH_STATE"
    | "MATCH_ENDED"
    | "PROGRESS"
    | "RESULTS"
    | "REMATCH_OFFER"
    | "REMATCH_DECLINED"
    | "REMATCH_STATUS"
    | "ERROR"
    | "PONG";
  payload: unknown;
};

export function toJson(msg: ServerMessage) {
  return JSON.stringify(msg);
}
