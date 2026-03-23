/** @jest-environment node */

import { AUTO_SANCTION_THRESHOLD, FLAG_THRESHOLD, recordCheatAssessment } from "../../services/pvp-gateway/src/anti-cheat/flagging";

describe("anti-cheat flagging", () => {
  it("does not persist below the flag threshold", async () => {
    const onConflictDoUpdate = jest.fn();
    const values = jest.fn(() => ({ onConflictDoUpdate }));
    const insert = jest.fn(() => ({ values }));
    const result = await recordCheatAssessment({
      db: { insert } as never,
      userId: "user-1",
      matchId: "match-1",
      confidence: FLAG_THRESHOLD - 0.1,
      flags: ["sudden_wpm_spike"],
    });

    expect(result.persisted).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("persists flags once the threshold is reached", async () => {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(null);
    const values = jest.fn(() => ({ onConflictDoUpdate }));
    const insert = jest.fn(() => ({ values }));
    const result = await recordCheatAssessment({
      db: { insert } as never,
      userId: "user-2",
      matchId: "match-2",
      confidence: FLAG_THRESHOLD,
      flags: ["impossible_sustained_speed"],
    });

    expect(result.persisted).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("marks high-confidence assessments as sanction candidates without banning", async () => {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(null);
    const values = jest.fn(() => ({ onConflictDoUpdate }));
    const insert = jest.fn(() => ({ values }));
    const result = await recordCheatAssessment({
      db: { insert } as never,
      userId: "user-3",
      matchId: "match-3",
      confidence: AUTO_SANCTION_THRESHOLD,
      flags: ["impossible_sustained_speed", "extremely_low_timing_variance"],
    });

    expect(result.wouldSanction).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });
});