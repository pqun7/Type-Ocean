import { z } from "zod";

const MAX_MESSAGE_BYTES = 1024;
const MAX_INPUT_MESSAGE_BYTES = 4096;

function jsonByteLength(value: unknown) {
  const json = JSON.stringify(value);
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(json).length;
  }
  return Buffer.byteLength(json, "utf8");
}

function withByteLimit<T extends z.ZodTypeAny>(schema: T, maxBytes: number, message: string) {
  return schema.superRefine((value, ctx) => {
    if (jsonByteLength(value) > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message,
      });
    }
  });
}

export const TypingLanguageSchema = z.enum(["en", "ar", "es", "fr"]);
export const PvpClientSecretSchema = z.string().trim().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const PvpWsTokenSchema = z.string().min(32).max(4096);
export const RoomCodeSchema = z.string().trim().min(4).max(10).regex(/^[a-zA-Z0-9]+$/);

const HelloMessageBaseSchema = z
  .object({
    type: z.literal("HELLO"),
    payload: z
      .object({
        token: PvpWsTokenSchema,
        clientSecret: PvpClientSecretSchema,
      })
      .strict(),
  })
  .strict();

export const HelloMessageSchema = withByteLimit(HelloMessageBaseSchema, MAX_MESSAGE_BYTES, "HELLO payload is too large");

const AuthRefreshMessageBaseSchema = z
  .object({
    type: z.literal("AUTH_REFRESH"),
    payload: z
      .object({
        token: PvpWsTokenSchema,
        clientSecret: PvpClientSecretSchema,
      })
      .strict(),
  })
  .strict();

export const AuthRefreshMessageSchema = withByteLimit(
  AuthRefreshMessageBaseSchema,
  MAX_MESSAGE_BYTES,
  "AUTH_REFRESH payload is too large"
);

const QueueJoinMessageBaseSchema = z
  .object({
    type: z.literal("QUEUE_JOIN"),
    payload: z
      .object({
        language: TypingLanguageSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const QueueJoinMessageSchema = withByteLimit(
  QueueJoinMessageBaseSchema,
  MAX_MESSAGE_BYTES,
  "QUEUE_JOIN payload is too large"
);

const QueueLeaveMessageBaseSchema = z
  .object({
    type: z.literal("QUEUE_LEAVE"),
    payload: z.object({}).strict(),
  })
  .strict();

export const QueueLeaveMessageSchema = withByteLimit(
  QueueLeaveMessageBaseSchema,
  MAX_MESSAGE_BYTES,
  "QUEUE_LEAVE payload is too large"
);

const RoomJoinMessageBaseSchema = z
  .object({
    type: z.literal("ROOM_JOIN"),
    payload: z
      .object({
        code: RoomCodeSchema,
        language: TypingLanguageSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const RoomJoinMessageSchema = withByteLimit(RoomJoinMessageBaseSchema, MAX_MESSAGE_BYTES, "ROOM_JOIN payload is too large");

const ReadyMessageBaseSchema = z
  .object({
    type: z.literal("READY"),
    payload: z
      .object({
        roomCode: RoomCodeSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ReadyMessageSchema = withByteLimit(ReadyMessageBaseSchema, MAX_MESSAGE_BYTES, "READY payload is too large");

const MatchJoinMessageBaseSchema = z
  .object({
    type: z.literal("MATCH_JOIN"),
    payload: z
      .object({
        matchId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

export const MatchJoinMessageSchema = withByteLimit(
  MatchJoinMessageBaseSchema,
  MAX_MESSAGE_BYTES,
  "MATCH_JOIN payload is too large"
);

const InputUpdateMessageBaseSchema = z
  .object({
    type: z.literal("INPUT_UPDATE"),
    payload: z
      .object({
        matchId: z.string().uuid(),
        input: z.string().max(20_000),
        seq: z.number().int().min(1).max(1_000_000),
        clientTs: z.number().int().min(0).max(9_999_999_999_999).optional(),
      })
      .strict(),
  })
  .strict();

export const InputUpdateMessageSchema = withByteLimit(
  InputUpdateMessageBaseSchema,
  MAX_INPUT_MESSAGE_BYTES,
  "INPUT_UPDATE payload is too large"
);

const FinishMessageBaseSchema = z
  .object({
    type: z.literal("FINISH"),
    payload: z
      .object({
        matchId: z.string().uuid(),
        clientTs: z.number().int().min(0).max(9_999_999_999_999).optional(),
      })
      .strict(),
  })
  .strict();

export const FinishMessageSchema = withByteLimit(FinishMessageBaseSchema, MAX_MESSAGE_BYTES, "FINISH payload is too large");

const RematchRequestMessageBaseSchema = z
  .object({
    type: z.literal("REMATCH_REQUEST"),
    payload: z
      .object({
        matchId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

export const RematchRequestMessageSchema = withByteLimit(
  RematchRequestMessageBaseSchema,
  MAX_MESSAGE_BYTES,
  "REMATCH_REQUEST payload is too large"
);

const RematchResponseMessageBaseSchema = z
  .object({
    type: z.literal("REMATCH_RESPONSE"),
    payload: z
      .object({
        matchId: z.string().uuid(),
        accept: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const RematchResponseMessageSchema = withByteLimit(
  RematchResponseMessageBaseSchema,
  MAX_MESSAGE_BYTES,
  "REMATCH_RESPONSE payload is too large"
);

export const PvpClientMessageSchema = z
  .discriminatedUnion("type", [
    HelloMessageBaseSchema,
    AuthRefreshMessageBaseSchema,
    QueueJoinMessageBaseSchema,
    QueueLeaveMessageBaseSchema,
    RoomJoinMessageBaseSchema,
    ReadyMessageBaseSchema,
    MatchJoinMessageBaseSchema,
    InputUpdateMessageBaseSchema,
    FinishMessageBaseSchema,
    RematchRequestMessageBaseSchema,
    RematchResponseMessageBaseSchema,
  ])
  .superRefine((value, ctx) => {
    const maxBytes = value.type === "INPUT_UPDATE" ? MAX_INPUT_MESSAGE_BYTES : MAX_MESSAGE_BYTES;
    if (jsonByteLength(value) > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} payload is too large`,
      });
    }
  });

export type PvpClientMessage = z.infer<typeof PvpClientMessageSchema>;
