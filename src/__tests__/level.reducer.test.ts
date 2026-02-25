import { levelReducer } from "@/features/level/reducers/levelReducer";

describe("levelReducer", () => {
  it("RESET_PROGRESS resets to defaults", () => {
    const prev = {
      level: 7,
      userXP: 123,
      nextLevelXP: 999,
      achievements: [{ id: "a1", unlocked: true, progress: { current: 1, target: 2 } }],
    };

    const next = levelReducer(prev as any, { type: "RESET_PROGRESS" } as any);

    expect(next.level).toBe(1);
    expect(next.userXP).toBe(0);
    expect(next.achievements).toEqual([]);
    expect(next.nextLevelXP).toBeGreaterThan(0);
  });
});
