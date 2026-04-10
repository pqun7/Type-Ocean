/** @jest-environment node */

import {
  areMatchmakingPreferencesCompatible,
  buildQueueBucketKey,
  canUsersMatchByRating,
  getExpandedQueueRatingRange,
} from "../matchmaking/bands";

describe("pvp matchmaking bands", () => {
  it("expands the queue band every thirty seconds and caps at 300", () => {
    expect(getExpandedQueueRatingRange(0)).toBe(50);
    expect(getExpandedQueueRatingRange(30_000)).toBe(125);
    expect(getExpandedQueueRatingRange(60_000)).toBe(200);
    expect(getExpandedQueueRatingRange(120_000)).toBe(300);
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
    // After 30 s, the long-waiting user expands to ±125; gap of 120 fits
    expect(
      canUsersMatchByRating({
        myRating: 1500,
        otherRating: 1620,
        myJoinedAtMs: 0,
        otherJoinedAtMs: 30_000,
        nowMs: 30_000,
      })
    ).toBe(true);

    // Both users only waited 20 s (< 1 expansion step) → range stays at 50; gap of 305 exceeds it
    expect(
      canUsersMatchByRating({
        myRating: 1500,
        otherRating: 1805,
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