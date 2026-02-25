import { z } from "zod";
const TypingLanguageSchema = z.enum(["en", "ar", "es", "fr"]);

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("HELLO"),
    payload: z.object({ token: z.string().min(10) }),
  }),
  z.object({
    type: z.literal("QUEUE_JOIN"),
    payload: z
      .object({
        language: TypingLanguageSchema.optional(),
      })
      .default({}),
  }),
  z.object({ type: z.literal("QUEUE_LEAVE"), payload: z.object({}).default({}) }),
  z.object({
    type: z.literal("ROOM_JOIN"),
    payload: z.object({ code: z.string().min(4).max(10), language: TypingLanguageSchema.optional() }),
  }),
  z.object({
    type: z.literal("READY"),
    payload: z.object({ roomCode: z.string().min(4).max(10) }).optional(),
  }),
  z.object({
    type: z.literal("MATCH_JOIN"),
    payload: z.object({ matchId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal("INPUT_UPDATE"),
    payload: z.object({
      matchId: z.string().uuid(),
      input: z.string().max(20000),
      seq: z.number().int().min(0).max(1_000_000),
      clientTs: z.number().int().optional(),
    }),
  }),
  z.object({
    type: z.literal("FINISH"),
    payload: z.object({
      matchId: z.string().uuid(),
      clientTs: z.number().int().optional(),
    }),
  }),
  z.object({
    type: z.literal("REMATCH_REQUEST"),
    payload: z.object({ matchId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal("REMATCH_RESPONSE"),
    payload: z.object({ matchId: z.string().uuid(), accept: z.boolean() }),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export function safeParseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw);
    const res = ClientMessageSchema.safeParse(parsed);
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

export type ServerMessage = {
  type:
    | "HELLO_OK"
    | "QUEUE_STATUS"
    | "ROOM_STATE"
    | "MATCH_FOUND"
    | "MATCH_STATE"
    | "PROGRESS"
    | "RESULTS"
    | "REMATCH_OFFER"
    | "REMATCH_DECLINED"
    | "REMATCH_STATUS"
    | "ERROR";
  payload: unknown;
};

export function toJson(msg: ServerMessage) {
  return JSON.stringify(msg);
}
