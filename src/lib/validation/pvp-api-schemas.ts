import { z } from "zod";

export const PvpRoomCreateBodySchema = z
  .object({
    maxPlayers: z.number().int().min(2).max(6).optional(),
  })
  .strict();

export const PvpClientSecretHeaderSchema = z.string().trim().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);

export type PvpRoomCreateBody = z.infer<typeof PvpRoomCreateBodySchema>;
