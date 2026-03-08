import {
  OVERALL_KEYBOARD_PERFORMANCE_VERSION,
  getTotalsFromPerformance,
  parseOverallKeyboardPerformance,
} from "@/components/TypingTest/utils/overallKeyboardPerformance";

describe("overallKeyboardPerformance", () => {
  it("computes totals from performance map", () => {
    const totals = getTotalsFromPerformance({
      a: { correct: 3, error: 1 },
      Space: { correct: 5, error: 2 },
      ShiftLeft: undefined,
    });

    expect(totals).toEqual({ correct: 8, error: 3 });
  });

  it("parses valid snapshot payload", () => {
    const parsed = parseOverallKeyboardPerformance(
      JSON.stringify({
        version: OVERALL_KEYBOARD_PERFORMANCE_VERSION,
        updatedAt: new Date().toISOString(),
        lastLanguage: "ar",
        sessions: 4,
        total: { a: { correct: 2, error: 1 } },
        byLanguage: {
          en: {},
          ar: { q: { correct: 4, error: 0 } },
          fr: {},
          es: {},
        },
      })
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.lastLanguage).toBe("ar");
    expect(parsed?.sessions).toBe(4);
    expect(parsed?.total.a).toEqual({ correct: 2, error: 1 });
  });
});
