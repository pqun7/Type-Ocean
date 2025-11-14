// lib/validation/challengeSchemas.ts
import { z } from 'zod';

export const SessionDataSchema = z.object({
  wpm: z.number().min(0).max(300),
  accuracy: z.number().min(0).max(100),
  textLength: z.number().int().min(0),
  timeSpent: z.number().min(0),
  errors: z.number().int().min(0),
  dailyAvgWpm: z.number().min(0).optional(),
  dailyAvgAcc: z.number().min(0).max(100).optional(),
  sessionsCount: z.number().int().min(0).optional(),
  textType: z.string().optional(),
});

export const ChallengeProgressSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('speedCombo'),
    wpm: z.number(),
    accuracy: z.number(),
    completed: z.boolean(),
  }),
  z.object({
    type: z.literal('marathon'),
    charactersTyped: z.number(),
    target: z.number(),
  }),
  z.object({
    type: z.literal('timeAttack'),
    timeSpent: z.number(),
  }),
  // ... other challenge types
]);

export const validateChallenge = (data: unknown) => {
  return SessionDataSchema.parse(data);
};