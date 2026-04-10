import { MatchmakingPreferenceSchema } from "@/lib/validation/pvp-api-schemas";
import { PvpRoomCreateBodySchema } from "@/lib/validation/pvp-api-schemas";

describe("pvp api schemas", () => {
  it("accepts a valid matchmaking preference payload", () => {
    const result = MatchmakingPreferenceSchema.safeParse({
      mode: "ranked_1v1",
      textDifficulty: "hard",
    });

    expect(result.success).toBe(true);
  });

  it("rejects unsupported matchmaking preference values", () => {
    const result = MatchmakingPreferenceSchema.safeParse({
      mode: "arcade",
      textDifficulty: "nightmare",
    });

    expect(result.success).toBe(false);
  });

  it("accepts valid private room payload", () => {
    expect(PvpRoomCreateBodySchema.safeParse({ maxPlayers: 6 }).success).toBe(true);
    expect(PvpRoomCreateBodySchema.safeParse({}).success).toBe(true);
  });
});