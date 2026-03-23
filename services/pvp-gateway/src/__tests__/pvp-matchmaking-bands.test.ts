/** @jest-environment node */

import {
  areMatchmakingPreferencesCompatible,
  buildQueueBucketKey,
  canUsersMatchByRating,
  getExpandedQueueRatingRange,
} from "../matchmaking/bands";

describe("pvp matchmaking bands", () => {
  it("expands the queue band every five seconds and caps at 200", () => {
    expect(getExpandedQueueRatingRange(0)).toBe(50);
    expect(getExpandedQueueRatingRange(5_000)).toBe(75);
    expect(getExpandedQueueRatingRange(10_000)).toBe(100);
    expect(getExpandedQueueRatingRange(60_000)).toBe(200);
  });

  it("matches only compatible preferences", () => {
    expect(
      areMatchmakingPreferencesCompatible(
        { mode: "ranked_1v1", textDifficulty: "normal" },
        { mode: "ranked_1v1", textDifficulty: "normal" }
      )
    ).toBe(true);

    expect(
      areMatchmakingPreferencesCompatible(
        { mode: "ranked_1v1", textDifficulty: "hard" },
        { mode: "ranked_1v1", textDifficulty: "easy" }
      )
    ).toBe(true);
  });

  it("uses the wider of the two expanded bands for fairness", () => {
    expect(
      canUsersMatchByRating({
        myRating: 1500,
        otherRating: 1620,
        myJoinedAtMs: 0,
        otherJoinedAtMs: 20_000,
        nowMs: 20_000,
      })
    ).toBe(true);

    expect(
      canUsersMatchByRating({
        myRating: 1500,
        otherRating: 1705,
        myJoinedAtMs: 0,
        otherJoinedAtMs: 0,
        nowMs: 20_000,
      })
    ).toBe(false);
  });

  it("builds stable queue bucket keys from normalized preferences", () => {
    expect(buildQueueBucketKey("pvp:queue:ranked", { mode: "RANKED_1V1", textDifficulty: "HARD" })).toBe(
      "pvp:queue:ranked:ranked_1v1"
    );
  });
});