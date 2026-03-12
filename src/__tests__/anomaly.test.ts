/** @jest-environment node */

import { assessMatch, type AntiCheatInputEvent } from "../../services/pvp-gateway/src/anti-cheat/anomaly";

function buildEvents(values: Array<Partial<AntiCheatInputEvent>>) {
  return values.map((value, index) => ({
    atMs: value.atMs ?? index * 120,
    inputLength: value.inputLength ?? index + 1,
    deltaChars: value.deltaChars ?? 1,
    wpm: value.wpm ?? 70,
  }));
}

describe("anti-cheat anomaly assessment", () => {
  it("keeps normal human typing below the flag threshold", async () => {
    const result = await assessMatch(
      "match-1",
      "user-1",
      buildEvents([
        { atMs: 100, inputLength: 1, deltaChars: 1, wpm: 65 },
        { atMs: 260, inputLength: 2, deltaChars: 1, wpm: 68 },
        { atMs: 430, inputLength: 3, deltaChars: 1, wpm: 70 },
        { atMs: 610, inputLength: 4, deltaChars: 1, wpm: 72 },
        { atMs: 790, inputLength: 5, deltaChars: 1, wpm: 71 },
      ])
    );

    expect(result.confidence).toBeLessThan(0.75);
    expect(result.flags).toEqual([]);
  });

  it("excludes bot participants from anomaly scoring", async () => {
    const result = await assessMatch("match-1", "ai:bot", buildEvents([{ atMs: 1 }]), { isBot: true });

    expect(result).toEqual({ confidence: 0, flags: [] });
  });

  it("flags impossible speed and low timing variance bursts", async () => {
    const result = await assessMatch(
      "match-2",
      "user-2",
      buildEvents([
        { atMs: 10, inputLength: 4, deltaChars: 4, wpm: 120 },
        { atMs: 20, inputLength: 8, deltaChars: 4, wpm: 160 },
        { atMs: 30, inputLength: 12, deltaChars: 4, wpm: 200 },
        { atMs: 40, inputLength: 16, deltaChars: 4, wpm: 220 },
        { atMs: 50, inputLength: 20, deltaChars: 4, wpm: 240 },
        { atMs: 60, inputLength: 24, deltaChars: 4, wpm: 250 },
        { atMs: 70, inputLength: 28, deltaChars: 4, wpm: 255 },
        { atMs: 80, inputLength: 32, deltaChars: 4, wpm: 260 },
      ])
    );

    expect(result.flags).toContain("impossible_sustained_speed");
    expect(result.flags).toContain("extremely_low_timing_variance");
    expect(result.confidence).toBeGreaterThan(0.75);
  });

  it("flags perfect corrections and sudden spikes", async () => {
    const result = await assessMatch(
      "match-3",
      "user-3",
      buildEvents([
        { atMs: 100, inputLength: 5, deltaChars: 5, wpm: 60 },
        { atMs: 200, inputLength: 4, deltaChars: -1, wpm: 58 },
        { atMs: 260, inputLength: 5, deltaChars: 1, wpm: 120 },
        { atMs: 320, inputLength: 4, deltaChars: -1, wpm: 62 },
        { atMs: 380, inputLength: 5, deltaChars: 1, wpm: 135 },
        { atMs: 440, inputLength: 4, deltaChars: -1, wpm: 60 },
        { atMs: 500, inputLength: 5, deltaChars: 1, wpm: 140 },
      ])
    );

    expect(result.flags).toContain("perfect_corrections");
    expect(result.flags).toContain("sudden_wpm_spike");
  });
});