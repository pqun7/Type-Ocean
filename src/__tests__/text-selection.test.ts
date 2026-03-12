/** @jest-environment node */

jest.mock("../../services/pvp-gateway/src/texts", () => ({
  loadLongTexts: () => [
    "A".repeat(200),
    "B".repeat(200),
    "C".repeat(200),
  ],
}));

import { getDeterministicRankedTextIndex, selectRankedText } from "../../services/pvp-gateway/src/anti-cheat/text-selection";

describe("ranked text selection", () => {
  it("is deterministic for the same match id and secret", () => {
    const a = getDeterministicRankedTextIndex("match-a", 100, "secret-1");
    const b = getDeterministicRankedTextIndex("match-a", 100, "secret-1");

    expect(a).toBe(b);
  });

  it("changes with a different match id", () => {
    const a = getDeterministicRankedTextIndex("match-a", 100, "secret-1");
    const b = getDeterministicRankedTextIndex("match-b", 100, "secret-1");

    expect(a).not.toBe(b);
  });

  it("avoids immediately repeating recent texts for a user", async () => {
    const first = await selectRankedText({
      matchId: "match-a",
      userIds: ["user-1"],
      secretSalt: "secret-1",
    });

    const second = await selectRankedText({
      matchId: "match-b",
      userIds: ["user-1"],
      secretSalt: "secret-1",
    });

    expect(first.textId).not.toBe(second.textId);
  });
});