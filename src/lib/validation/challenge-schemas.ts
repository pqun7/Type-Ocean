import { z } from "zod";

const TextTypeSchema = z.enum(["SHORT", "MEDIUM", "LONG"]);

export const ChallengeSessionProgressSchema = z
  .object({
    wpm: z.number().min(0).max(300).optional(),
    accuracy: z.number().min(0).max(100).optional(),
    textLength: z.number().int().min(0).max(20_000).optional(),
    textType: TextTypeSchema.optional(),
    timeSpent: z.number().int().min(0).max(7_200).optional(),
    errors: z.number().int().min(0).max(5_000).optional(),
    dailyAvgWpm: z.number().min(0).max(300).optional(),
    dailyAvgAcc: z.number().min(0).max(100).optional(),
    sessionsCount: z.number().int().min(0).max(1_000).optional(),
    corrections: z.number().int().min(0).max(20_000).optional(),
    consistency: z.number().min(0).max(100).optional(),
    prevBestWpm: z.number().min(0).max(300).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one progress field is required",
  });

export const ChallengeUpdateBodySchema = z.union([
  ChallengeSessionProgressSchema,
  z.object({ session: ChallengeSessionProgressSchema }).strict(),
  z.object({ progress: ChallengeSessionProgressSchema }).strict(),
]);

export const ChallengePatchBodySchema = z
  .object({
    progress: ChallengeSessionProgressSchema,
    operation: z.enum(["increment", "replace"]).optional(),
  })
  .strict();
