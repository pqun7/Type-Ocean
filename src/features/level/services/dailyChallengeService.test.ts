import { sanitizeSessionData, validateChallengeData } from "./dailyChallengeService";
import type { DailyChallenge } from "../types/level";

describe("dailyChallengeService", () => {
  describe("sanitizeSessionData", () => {
    it("clamps extreme values and coerces to numbers", () => {
      const sanitized = sanitizeSessionData({
        wpm: 9999,
        accuracy: -5,
        textLength: -100,
        timeSpent: -1,
        errors: -10,
        dailyAvgWpm: 500,
        dailyAvgAcc: 101,
        sessionsCount: -3,
        textType: "SHORT",
      });

      expect(sanitized.wpm).toBe(300);
      expect(sanitized.accuracy).toBe(0);
      expect(sanitized.textLength).toBe(0);
      expect(sanitized.timeSpent).toBe(0);
      expect(sanitized.errors).toBe(0);
      expect(sanitized.dailyAvgWpm).toBeGreaterThanOrEqual(0);
      expect(sanitized.dailyAvgAcc).toBe(101); // service allows 0..inf then API clamps later
      expect(sanitized.sessionsCount).toBe(0);
    });
  });

  describe("validateChallengeData", () => {
    it("accepts a valid challenge object", () => {
      const challenge: DailyChallenge = {
        id: "c1",
        date: "2026-02-14",
        type: "speedCombo",
        target: { wpm: 60, accuracy: 95 },
        xp: 100,
        difficulty: 1,
        status: 0,
        data: {},
      };

      expect(validateChallengeData(challenge)).toBe(true);
    });

    it("rejects invalid challenge shapes", () => {
      expect(validateChallengeData(null as unknown as DailyChallenge)).toBe(false);
      expect(validateChallengeData({} as unknown as DailyChallenge)).toBe(false);

      const missingFields = {
        id: "c2",
        date: "2026-02-14",
        type: "speedCombo",
      };
      expect(validateChallengeData(missingFields as unknown as DailyChallenge)).toBe(false);

      const badType = {
        id: "c3",
        date: "2026-02-14",
        type: "unknown",
        target: 1,
        xp: 100,
        status: 0,
      };
      expect(validateChallengeData(badType as unknown as DailyChallenge)).toBe(false);
    });
  });
});
