/** @jest-environment node */

import { runDisconnectForfeitSequence } from "../disconnect-forfeit";

describe("disconnect forfeit sequencing", () => {
  it("sends MATCH_ENDED before final results work", async () => {
    const order: string[] = [];

    await runDisconnectForfeitSequence({
      sendMatchEnded: () => {
        order.push("match-ended");
      },
      finalizeResults: async () => {
        order.push("results");
      },
    });

    expect(order).toEqual(["match-ended", "results"]);
  });
});