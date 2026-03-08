import { ChallengePatchBodySchema, ChallengeUpdateBodySchema } from "@/lib/validation/challenge-schemas";

describe("Challenge validation schemas", () => {
  it("accepts a wrapped session update payload", () => {
    const result = ChallengeUpdateBodySchema.safeParse({
      session: {
        wpm: 92,
        accuracy: 98.5,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty challenge progress payloads", () => {
    const result = ChallengeUpdateBodySchema.safeParse({ progress: {} });
    expect(result.success).toBe(false);
  });

  it("rejects invalid PATCH operations", () => {
    const result = ChallengePatchBodySchema.safeParse({
      progress: { wpm: 80 },
      operation: "merge",
    });

    expect(result.success).toBe(false);
  });
});
