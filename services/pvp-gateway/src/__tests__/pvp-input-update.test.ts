/** @jest-environment node */

import { shouldAcceptInputUpdate } from "../input-update";

describe("input update acceptance", () => {
  it("prefers seq monotonicity before idempotency replay checks", () => {
    expect(
      shouldAcceptInputUpdate({
        lastProcessedSeq: 10,
        incomingSeq: 10,
        cachedProcessedSeq: 10,
      })
    ).toEqual({ accept: false, reason: "stale_seq" });

    expect(
      shouldAcceptInputUpdate({
        lastProcessedSeq: 10,
        incomingSeq: 11,
        cachedProcessedSeq: 11,
      })
    ).toEqual({ accept: false, reason: "duplicate_request" });
  });

  it("handles high-frequency seq progression without rejecting valid new updates", () => {
    let lastProcessedSeq = 0;
    for (let seq = 1; seq <= 2000; seq += 1) {
      const decision = shouldAcceptInputUpdate({
        lastProcessedSeq,
        incomingSeq: seq,
        cachedProcessedSeq: null,
      });

      expect(decision).toEqual({ accept: true });
      lastProcessedSeq = seq;
    }
  });
});