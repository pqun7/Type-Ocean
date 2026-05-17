import {
  buildKeyboardPerformanceData,
  mapCharacterToKeyId,
} from "@/components/TypingTest/utils/keyboardPerformance";

describe("keyboardPerformance mapping", () => {
  it("maps core letters and symbols across supported languages", () => {
    expect(mapCharacterToKeyId("ض", "ar")).toBe("q");
    expect(mapCharacterToKeyId("؟", "ar")).toBe("Slash");
    expect(mapCharacterToKeyId("!", "en")).toBe("1");
    expect(mapCharacterToKeyId(" ", "en")).toBe("Space");
  });

  it("builds per-key correct and error counts", () => {
    const data = buildKeyboardPerformanceData("a?", "az", "en");

    expect(data.a).toEqual({ correct: 1, error: 0 });
    expect(data.Slash).toEqual({ correct: 0, error: 1 });
    expect(data.ShiftLeft).toEqual({ correct: 0, error: 1 });
    expect(data.ShiftRight).toEqual({ correct: 0, error: 1 });
  });

  it("tracks space and capslock/shift requirements", () => {
    const capsData = buildKeyboardPerformanceData("USA Test", "USA Test", "en");
    expect(capsData.Space).toEqual({ correct: 1, error: 0 });
    expect(capsData.CapsLock).toEqual({ correct: 3, error: 0 });

    const shiftData = buildKeyboardPerformanceData("A", "A", "en");
    expect(shiftData.ShiftLeft).toEqual({ correct: 1, error: 0 });
    expect(shiftData.ShiftRight).toEqual({ correct: 1, error: 0 });
  });

  it("tracks arabic shift-required marks", () => {
    const arabicShift = buildKeyboardPerformanceData("؟", "؟", "ar");
    expect(arabicShift.ShiftLeft).toEqual({ correct: 1, error: 0 });
    expect(arabicShift.ShiftRight).toEqual({ correct: 1, error: 0 });
  });
});
