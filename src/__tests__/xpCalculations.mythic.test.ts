import { calculateSessionXP, validateSessionData } from "@/features/level/utils/xpCalculations";
import type { LevelState, MythicClaimMeta, SessionData } from "@/features/level/types/level";

const baseState: LevelState = {
  level: 10,
  userXP: 0,
  nextLevelXP: 5000,
  achievements: [],
};

/** Factory for a "perfect" mid-level flawless session */
const flawlessBase = (): SessionData => ({
  wpm: 75,
  accuracy: 100,
  textLength: 300,
  textType: "MEDIUM",
  timeSpent: 60,
  errors: 0,
  dailyAvgWpm: 75,
  dailyAvgAcc: 100,
  sessionsCount: 1,
  corrections: 0,
  consistency: 92,
  prevBestWpm: 0,
});

// ─── validateSessionData ──────────────────────────────────────────────────────

describe("validateSessionData", () => {
  it("rejects NaN wpm", () => {
    expect(validateSessionData({ ...flawlessBase(), wpm: NaN })).toBe(false);
  });

  it("rejects Infinity accuracy", () => {
    expect(validateSessionData({ ...flawlessBase(), accuracy: Infinity })).toBe(false);
  });

  it("rejects negative errors", () => {
    expect(validateSessionData({ ...flawlessBase(), errors: -1 })).toBe(false);
  });

  it("accepts a fully valid session", () => {
    expect(validateSessionData(flawlessBase())).toBe(true);
  });

  it("accepts session without optional extended fields", () => {
    const { corrections, consistency, prevBestWpm, ...partial } = flawlessBase();
    expect(validateSessionData(partial as SessionData)).toBe(true);
  });
});

// ─── Mutual exclusivity ───────────────────────────────────────────────────────

describe("perfect_storm mutual exclusivity", () => {
  it("fires perfect_storm and suppresses standalone flawless_run + personal-best", () => {
    const session: SessionData = {
      ...flawlessBase(),
      wpm: 80,
      prevBestWpm: 70,  // wpm beats record → perfect_storm qualifies
      consistency: 93,
    };

    const notifications: Array<{ text: string; type: string }> = [];
    const claims: MythicClaimMeta[] = [];

    calculateSessionXP(
      session,
      baseState,
      "test-user",
      (text, _value, type) => notifications.push({ text, type }),
      undefined,
      (meta) => claims.push(meta),
    );

    const texts = notifications.map((n) => n.text);
    const types = notifications.map((n) => n.type);

    expect(texts.some((t) => t.includes("Perfect Storm"))).toBe(true);
    expect(texts.some((t) => t.includes("Flawless"))).toBe(false);     // subsumed
    expect(types).not.toContain("personal-best");                        // subsumed

    expect(claims).toHaveLength(1);
    expect(claims[0]?.isMythicClaim).toBe(true);
  });
});

// ─── Steady Hands bonus ───────────────────────────────────────────────────────

describe("Steady Hands bonus", () => {
  it("does NOT fire when consistency < 80", () => {
    const session: SessionData = { ...flawlessBase(), consistency: 79 };
    const names: string[] = [];
    calculateSessionXP(session, baseState, undefined, (text) => names.push(text));
    expect(names).not.toContain("Steady Hands");
  });

  it("fires and stays ≤ 200 XP at consistency = 95", () => {
    const session: SessionData = { ...flawlessBase(), consistency: 95, wpm: 75 };
    const notifications: Array<{ text: string; value: number }> = [];
    calculateSessionXP(session, baseState, undefined, (text, value) =>
      notifications.push({ text, value }),
    );

    const steady = notifications.find((n) => n.text === "Steady Hands");
    expect(steady).toBeDefined();
    expect(steady!.value).toBeGreaterThan(0);
    expect(steady!.value).toBeLessThanOrEqual(200);
  });

  it("does not throw when consistency is exactly at the threshold (80)", () => {
    const session: SessionData = { ...flawlessBase(), consistency: 80 };
    expect(() => calculateSessionXP(session, baseState)).not.toThrow();
  });
});

// ─── flawless_run conditions ──────────────────────────────────────────────────

describe("flawless_run mythic bonus", () => {
  it("does NOT fire when consistency < 85 (even with 0 errors/corrections, 100% acc)", () => {
    const session: SessionData = { ...flawlessBase(), consistency: 84 };
    const notifications: Array<{ text: string }> = [];
    calculateSessionXP(session, baseState, undefined, (text) => notifications.push({ text }));
    expect(notifications.some((n) => n.text.includes("Flawless"))).toBe(false);
  });

  it("fires when all conditions met (consistency ≥ 85, 0 errors, 0 corrections, 100% acc)", () => {
    const session: SessionData = { ...flawlessBase(), consistency: 90, wpm: 60 };
    const notifications: Array<{ text: string; type: string }> = [];
    calculateSessionXP(session, baseState, undefined, (text, _v, type) =>
      notifications.push({ text, type }),
    );
    expect(
      notifications.some((n) => n.text.includes("Flawless") && n.type === "mythic"),
    ).toBe(true);
  });
});

// ─── Mythic hard caps ─────────────────────────────────────────────────────────

describe("mythic hard caps", () => {
  it("speed_god XP never exceeds 520", () => {
    const state: LevelState = { ...baseState, level: 50 };
    const session: SessionData = {
      wpm: 200,
      accuracy: 99,
      textLength: 400,
      textType: "MEDIUM",
      timeSpent: 90,
      errors: 0,
      dailyAvgWpm: 200,
      dailyAvgAcc: 99,
      sessionsCount: 1,
      corrections: 0,
      consistency: 90,
      prevBestWpm: 0,
    };

    const notifications: Array<{ text: string; value: number }> = [];
    calculateSessionXP(session, state, undefined, (text, value) =>
      notifications.push({ text, value }),
    );

    const sg = notifications.find((n) => n.text.includes("Speed God"));
    if (sg) expect(sg.value).toBeLessThanOrEqual(520);
  });

  it("flawless_run XP never exceeds 380", () => {
    const state: LevelState = { ...baseState, level: 80 };
    const session: SessionData = { ...flawlessBase(), wpm: 150, consistency: 99 };

    const notifications: Array<{ text: string; value: number }> = [];
    calculateSessionXP(session, state, undefined, (text, value) =>
      notifications.push({ text, value }),
    );

    const fl = notifications.find((n) => n.text.includes("Flawless"));
    if (fl) expect(fl.value).toBeLessThanOrEqual(380);
  });
});

// ─── Personal Best bonus ──────────────────────────────────────────────────────

describe("Personal Best bonus", () => {
  it("fires when wpm > prevBestWpm and perfect_storm did not fire", () => {
    const session: SessionData = {
      ...flawlessBase(),
      wpm: 70,
      prevBestWpm: 65,
      consistency: 80,  // below flawless_run threshold → no perfect_storm
      corrections: 5,   // not flawless
    };

    const notifications: Array<{ text: string; type: string; value: number }> = [];
    calculateSessionXP(session, baseState, undefined, (text, value, type) =>
      notifications.push({ text, type, value }),
    );

    const pb = notifications.find((n) => n.type === "personal-best");
    expect(pb).toBeDefined();
    expect(pb!.value).toBeGreaterThan(0);
    expect(pb!.value).toBeLessThanOrEqual(280);
  });

  it("does NOT fire when wpm ≤ prevBestWpm", () => {
    const session: SessionData = { ...flawlessBase(), wpm: 65, prevBestWpm: 70 };
    const types: string[] = [];
    calculateSessionXP(session, baseState, undefined, (_t, _v, type) => types.push(type));
    expect(types).not.toContain("personal-best");
  });
});

// ─── correctionPenalty ────────────────────────────────────────────────────────

describe("correctionPenalty", () => {
  it("reduces base XP when corrections are high relative to text length", () => {
    const clean: SessionData = {
      ...flawlessBase(),
      corrections: 0,
      errors: 0,
      accuracy: 100,
      consistency: 80,
    };
    const messy: SessionData = {
      ...flawlessBase(),
      corrections: 30,
      errors: 5,
      accuracy: 95,
      consistency: 60,
    };
    expect(calculateSessionXP(clean, baseState)).toBeGreaterThan(
      calculateSessionXP(messy, baseState),
    );
  });
});

// ─── Speed tier mutual exclusivity ───────────────────────────────────────────

describe("speed tier mutual exclusivity", () => {
  const makeSpeedSession = (wpm: number): SessionData => ({
    wpm,
    accuracy: 97,
    textLength: 300,
    textType: "MEDIUM",
    timeSpent: 60,
    errors: 0,
    dailyAvgWpm: wpm,
    dailyAvgAcc: 97,
    sessionsCount: 1,
    corrections: 0,
    consistency: 85,
    prevBestWpm: 0,
  });

  it("fires Speed Racer (not Lightning Speed) at 65 WPM", () => {
    const names: string[] = [];
    calculateSessionXP(makeSpeedSession(65), baseState, undefined, (text) => names.push(text));
    expect(names).toContain("Speed Racer");
    expect(names).not.toContain("Lightning Speed");
  });

  it("fires Lightning Speed (not Speed Racer) at 85 WPM", () => {
    const names: string[] = [];
    calculateSessionXP(makeSpeedSession(85), baseState, undefined, (text) => names.push(text));
    expect(names).toContain("Lightning Speed");
    expect(names).not.toContain("Speed Racer");
  });

  it("fires neither speed bonus below 60 WPM", () => {
    const names: string[] = [];
    calculateSessionXP(makeSpeedSession(50), baseState, undefined, (text) => names.push(text));
    expect(names).not.toContain("Speed Racer");
    expect(names).not.toContain("Lightning Speed");
  });
});

// ─── Dynamic bonus floors ─────────────────────────────────────────────────────

describe("dynamic bonus rewards — floor = base xpReward", () => {
  const bareSession = (wpm: number, accuracy: number): SessionData => ({
    wpm,
    accuracy,
    textLength: 300,
    textType: "MEDIUM",
    timeSpent: 60,
    errors: accuracy < 100 ? 1 : 0,
    dailyAvgWpm: wpm,
    dailyAvgAcc: accuracy,
    sessionsCount: 1,
    corrections: 0,
    consistency: 75,
    prevBestWpm: 0,
  });

  it("Perfect Accuracy reward is ≥ 250 and ≤ 350", () => {
    const notifications: Array<{ text: string; value: number }> = [];
    calculateSessionXP(bareSession(50, 100), baseState, undefined, (text, value) =>
      notifications.push({ text, value }),
    );
    const pa = notifications.find((n) => n.text === "Perfect Accuracy");
    expect(pa).toBeDefined();
    expect(pa!.value).toBeGreaterThanOrEqual(250);
    expect(pa!.value).toBeLessThanOrEqual(350);
  });

  it("Speed Racer reward is ≥ 300 and ≤ 420 at 70 WPM", () => {
    const notifications: Array<{ text: string; value: number }> = [];
    calculateSessionXP(bareSession(70, 93), baseState, undefined, (text, value) =>
      notifications.push({ text, value }),
    );
    const sr = notifications.find((n) => n.text === "Speed Racer");
    expect(sr).toBeDefined();
    expect(sr!.value).toBeGreaterThanOrEqual(300);
    expect(sr!.value).toBeLessThanOrEqual(420);
  });

  it("Lightning Speed reward is ≥ 500 and ≤ 700 at 90 WPM", () => {
    const notifications: Array<{ text: string; value: number }> = [];
    calculateSessionXP(bareSession(90, 96), baseState, undefined, (text, value) =>
      notifications.push({ text, value }),
    );
    const ls = notifications.find((n) => n.text === "Lightning Speed");
    expect(ls).toBeDefined();
    expect(ls!.value).toBeGreaterThanOrEqual(500);
    expect(ls!.value).toBeLessThanOrEqual(700);
  });
});

// ─── New achievement conditions ───────────────────────────────────────────────

describe("new achievements", () => {
  const make = (overrides: Partial<SessionData> = {}): SessionData => ({
    wpm: 60,
    accuracy: 95,
    textLength: 300,
    textType: "MEDIUM",
    timeSpent: 60,
    errors: 2,
    dailyAvgWpm: 60,
    dailyAvgAcc: 95,
    sessionsCount: 1,
    corrections: 0,
    consistency: 80,
    prevBestWpm: 0,
    ...overrides,
  });

  it("velocity fires at exactly 80 WPM", () => {
     const names: string[] = [];
     calculateSessionXP(make({ wpm: 80 }), baseState, undefined, (t) => names.push(t));
     expect(names).toContain("Blitz");
  });

  it("velocity does NOT fire at 79 WPM", () => {
    const names: string[] = [];
    calculateSessionXP(make({ wpm: 79 }), baseState, undefined, (t) => names.push(t));
    expect(names).not.toContain("Velocity");
  });

  it("velocity_god fires at 120 WPM", () => {
    const names: string[] = [];
    calculateSessionXP(make({ wpm: 120, accuracy: 97, consistency: 85 }), baseState, undefined, (t) => names.push(t));
    expect(names).toContain("Velocity God");
  });

  it("consistent_edge accumulates progress and unlocks on 10th qualifying session", () => {
    const progressState: LevelState = {
      ...baseState,
      achievements: [{ id: "consistent_edge", unlocked: false, progress: { current: 9, target: 10 } }],
    };
    const names: string[] = [];
    calculateSessionXP(make({ consistency: 90 }), progressState, undefined, (t) => names.push(t));
    expect(names).toContain("Tempo");
  });

  it("consistent_edge does NOT fire when consistency < 85", () => {
    const progressState: LevelState = {
      ...baseState,
      achievements: [{ id: "consistent_edge", unlocked: false, progress: { current: 9, target: 10 } }],
    };
    const names: string[] = [];
    calculateSessionXP(make({ consistency: 84 }), progressState, undefined, (t) => names.push(t));
    expect(names).not.toContain("Consistent Edge");
  });

  it("century fires on the 100th session", () => {
    const progressState: LevelState = {
      ...baseState,
      achievements: [{ id: "century", unlocked: false, progress: { current: 99, target: 100 } }],
    };
    const names: string[] = [];
    calculateSessionXP(make(), progressState, undefined, (t) => names.push(t));
    expect(names).toContain("Centurion");
  });

  it("ghost_protocol fires on the 5th flawless session (100% acc, 0 errors, ≥95% consistency, ≥90 WPM)", () => {
    const at4: LevelState = {
      ...baseState,
      achievements: [{ id: "ghost_protocol", unlocked: false, progress: { current: 4, target: 5 } }],
    };
    const names: string[] = [];
    calculateSessionXP(
      make({ accuracy: 100, errors: 0, consistency: 97, wpm: 95 }),
      at4,
      undefined,
      (t) => names.push(t),
    );
    expect(names).toContain("Ghost Protocol");
  });

  it("ghost_protocol does NOT fire if accuracy < 100", () => {
    const at4: LevelState = {
      ...baseState,
      achievements: [{ id: "ghost_protocol", unlocked: false, progress: { current: 4, target: 5 } }],
    };
    const names: string[] = [];
    calculateSessionXP(
      make({ accuracy: 99, errors: 0, consistency: 97, wpm: 95 }),
      at4,
      undefined,
      (t) => names.push(t),
    );
    expect(names).not.toContain("Ghost Protocol");
  });

  it("ghost_protocol does NOT fire if consistency < 95", () => {
    const at4: LevelState = {
      ...baseState,
      achievements: [{ id: "ghost_protocol", unlocked: false, progress: { current: 4, target: 5 } }],
    };
    const names: string[] = [];
    calculateSessionXP(
      make({ accuracy: 100, errors: 0, consistency: 94, wpm: 95 }),
      at4,
      undefined,
      (t) => names.push(t),
    );
    expect(names).not.toContain("Ghost Protocol");
  });

  it("ghost_protocol dynamic reward is ≥ 5000 and ≤ 7000", () => {
    const at4: LevelState = {
      ...baseState,
      achievements: [{ id: "ghost_protocol", unlocked: false, progress: { current: 4, target: 5 } }],
    };
    const notifications: Array<{ text: string; value: number }> = [];
    calculateSessionXP(
      make({ accuracy: 100, errors: 0, consistency: 100, wpm: 130 }),
      at4,
      undefined,
      (text, value) => notifications.push({ text, value }),
    );
    const gp = notifications.find((n) => n.text === "Ghost Protocol");
    expect(gp).toBeDefined();
    expect(gp!.value).toBeGreaterThanOrEqual(5000);
    expect(gp!.value).toBeLessThanOrEqual(7000);
  });

  it("iron_fingers accumulates textLength and fires when total ≥ 100,000", () => {
    const progressState: LevelState = {
      ...baseState,
      achievements: [{ id: "iron_fingers", unlocked: false, progress: { current: 99700, target: 100000 } }],
    };
    const names: string[] = [];
    calculateSessionXP(make({ textLength: 300 }), progressState, undefined, (t) => names.push(t));
    expect(names).toContain("Iron Fingers");
  });

  it("velocity_god dynamic reward is ≥ 1500 and ≤ 2100", () => {
    const notifications: Array<{ text: string; value: number }> = [];
    calculateSessionXP(
      make({ wpm: 140, accuracy: 98, consistency: 88 }),
      baseState,
      undefined,
      (text, value) => notifications.push({ text, value }),
    );
    const vg = notifications.find((n) => n.text === "Velocity God");
    expect(vg).toBeDefined();
    expect(vg!.value).toBeGreaterThanOrEqual(1500);
    expect(vg!.value).toBeLessThanOrEqual(2100);
  });
});
