import { z } from "zod";

export const PvpRoomCreateBodySchema = z
  .object({
    maxPlayers: z.number().int().min(2).max(6).optional(),
  })
  .strict();

export const MatchmakingPreferenceSchema = z
  .object({
    mode: z.enum(["ranked_1v1"]).default("ranked_1v1"),
    textDifficulty: z.enum(["easy", "normal", "hard"]).default("normal"),
  })
  .strict();

export const PvpClientSecretHeaderSchema = z.string().trim().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);

export type PvpRoomCreateBody = z.infer<typeof PvpRoomCreateBodySchema>;
export type MatchmakingPreferenceInput = z.infer<typeof MatchmakingPreferenceSchema>;
