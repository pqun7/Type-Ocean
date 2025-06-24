import { DailyChallengeResponse } from '@/features/level/types/level';
import { z } from "zod";

const ChallengeResponseSchema = z.object({
    completed: z.boolean(),
    xp: z.number().min(0),
    updatedChallenge: z.object({
      id: z.string(),
      progress: z.record(z.any()),
      status: z.union([z.literal(0), z.literal(1), z.literal(-1)]), // 0: not started, 1: completed, -1: in progress
      date: z.string()
    })
  });
  
  export function validateChallengeResponse(data: unknown): DailyChallengeResponse {
    try {
      return ChallengeResponseSchema.parse(data);
    } catch (error) {
      throw new Error(`Invalid challenge response: ${error instanceof z.ZodError 
        ? error.errors.map(e => e.message).join(', ')
        : 'Unknown error'}`);
    }
  }