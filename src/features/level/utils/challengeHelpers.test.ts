import {
  calculateChallengeStatus,
  getChallengeStatusText,
  isChallengeCompleted,
  validateChallenge,
} from "./challengeHelpers";
import type { DailyChallenge } from "../types/level";

describe("calculateChallengeStatus", () => {
  it("keeps a completed challenge completed (does not revert)", () => {
    const challenge: DailyChallenge = {
      id: "c1",
      date: "2026-02-14",
      type: "speedCombo",
      target: { wpm: 60, accuracy: 95 },
      xp: 100,
      difficulty: 1,
      status: 1,
      data: { completedAt: "2026-02-14T10:00:00.000Z" },
    };

    // Even if the latest session would not satisfy the target,
    // status should stay completed.
    const status = calculateChallengeStatus(challenge, { wpm: 10, accuracy: 10 });
    expect(status).toBe(1);
  });

  it("marks as completed when progress meets criteria", () => {
    const challenge: DailyChallenge = {
      id: "c2",
      date: "2026-02-14",
      type: "speedCombo",
      target: { wpm: 60, accuracy: 95 },
      xp: 100,
      difficulty: 1,
      status: 0,
      data: {},
    };

    const status = calculateChallengeStatus(challenge, { wpm: 61, accuracy: 95 });
    expect(status).toBe(1);
  });

  it("returns 0 when there is no meaningful progress", () => {
    const challenge: DailyChallenge = {
      id: "c3",
      date: "2026-02-14",
      type: "timeAttack",
      target: 600,
      xp: 100,
      difficulty: 1,
      status: 0,
      data: { timeSpent: 0 },
    };

    expect(calculateChallengeStatus(challenge, { timeSpent: 0 })).toBe(0);
  });

  it("returns -1 when there is progress but not completed (marathon)", () => {
    const challenge: DailyChallenge = {
      id: "c4",
      date: "2026-02-14",
      type: "marathon",
      target: 300,
      xp: 100,
      difficulty: 1,
      status: 0,
      data: { charactersTyped: 0 },
    };

    expect(calculateChallengeStatus(challenge, { charactersTyped: 10 })).toBe(-1);
  });

  it("returns -1 when there is progress but not completed (timeAttack)", () => {
    const challenge: DailyChallenge = {
      id: "c5",
      date: "2026-02-14",
      type: "timeAttack",
      target: 600,
      xp: 100,
      difficulty: 1,
      status: 0,
      data: { timeSpent: 0 },
    };

    expect(calculateChallengeStatus(challenge, { timeSpent: 120 })).toBe(-1);
  });

  it("does not auto-complete from a boolean flag without numeric progress", () => {
    const challenge: DailyChallenge = {
      id: "c6",
      date: "2026-02-14",
      type: "speedCombo",
      target: { wpm: 60, accuracy: 95 },
      xp: 100,
      difficulty: 1,
      status: 0,
      data: {},
    };

    // Some legacy payloads may include { completed: true }.
    // We intentionally do not treat that as completion without meeting the criteria.
    expect(calculateChallengeStatus(challenge, { completed: true })).toBe(0);
  });
});

describe("isChallengeCompleted", () => {
  it("requires both WPM and accuracy for speedCombo", () => {
    const challenge: DailyChallenge = {
      id: "s1",
      date: "2026-02-14",
      type: "speedCombo",
      target: { wpm: 60, accuracy: 95 },
      xp: 100,
      difficulty: 1,
      status: 0,
      data: {},
    };

    expect(isChallengeCompleted(challenge, { wpm: 60, accuracy: 95 })).toBe(true);
    expect(isChallengeCompleted(challenge, { wpm: 60, accuracy: 94.9 })).toBe(false);
    expect(isChallengeCompleted(challenge, { wpm: 59.9, accuracy: 95 })).toBe(false);
  });

  it("checks charactersTyped for marathon", () => {
    const challenge: DailyChallenge = {
      id: "m1",
      date: "2026-02-14",
      type: "marathon",
      target: 300,
      xp: 100,
      difficulty: 1,
      status: 0,
      data: { charactersTyped: 0 },
    };

    expect(isChallengeCompleted(challenge, { charactersTyped: 299 })).toBe(false);
    expect(isChallengeCompleted(challenge, { charactersTyped: 300 })).toBe(true);
  });

  it("checks timeSpent for timeAttack", () => {
    const challenge: DailyChallenge = {
      id: "t1",
      date: "2026-02-14",
      type: "timeAttack",
      target: 600,
      xp: 100,
      difficulty: 1,
      status: 0,
      data: { timeSpent: 0 },
    };

    expect(isChallengeCompleted(challenge, { timeSpent: 599 })).toBe(false);
    expect(isChallengeCompleted(challenge, { timeSpent: 600 })).toBe(true);
  });
});

describe("validateChallenge", () => {
  it("rejects missing date or non-positive xp", () => {
    const bad1 = {
      id: "v1",
      date: "",
      type: "speedCombo",
      target: { wpm: 60, accuracy: 95 },
      xp: 100,
      difficulty: 1,
      status: 0,
      data: {},
    } as DailyChallenge;

    const bad2 = {
      id: "v2",
      date: "2026-02-14",
      type: "speedCombo",
      target: { wpm: 60, accuracy: 95 },
      xp: 0,
      difficulty: 1,
      status: 0,
      data: {},
    } as DailyChallenge;

    expect(validateChallenge(bad1)).toBe(false);
    expect(validateChallenge(bad2)).toBe(false);
  });

  it("rejects invalid targets by type", () => {
    const badMarathon: DailyChallenge = {
      id: "v3",
      date: "2026-02-14",
      type: "marathon",
      target: 10, // below MIN_LENGTH
      xp: 100,
      difficulty: 1,
      status: 0,
      data: { charactersTyped: 0 },
    };

    const badTimeAttack: DailyChallenge = {
      id: "v4",
      date: "2026-02-14",
      type: "timeAttack",
      target: 200, // below MIN_TIME
      xp: 100,
      difficulty: 1,
      status: 0,
      data: { timeSpent: 0 },
    };

    const badSpeedCombo: DailyChallenge = {
      id: "v5",
      date: "2026-02-14",
      type: "speedCombo",
      target: { wpm: 10, accuracy: 10 }, // below mins
      xp: 100,
      difficulty: 1,
      status: 0,
      data: {},
    };

    expect(validateChallenge(badMarathon)).toBe(false);
    expect(validateChallenge(badTimeAttack)).toBe(false);
    expect(validateChallenge(badSpeedCombo)).toBe(false);
  });
});

describe("getChallengeStatusText", () => {
  it("formats speedCombo status", () => {
    const challenge: DailyChallenge = {
      id: "g1",
      date: "2026-02-14",
      type: "speedCombo",
      target: { wpm: 60, accuracy: 95 },
      xp: 100,
      difficulty: 1,
      status: 0,
      data: {},
    };

    expect(getChallengeStatusText(challenge, { wpm: 50, accuracy: 90 })).toContain("WPM:");
  });
});
