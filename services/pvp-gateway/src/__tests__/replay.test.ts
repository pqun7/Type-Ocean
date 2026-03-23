/** @jest-environment node */

import {
  clearReplayProtection,
  registerAcceptedReplaySeq,
  registerReplayNonce,
  validateReplayProtectedInput,
} from "../anti-cheat/replay";

describe("replay protection", () => {
  const matchId = "8f2b21e0-b1dd-4b0c-8a6b-8d9ac9729477";
  const userId = "user-1";
  const nonce = "0123456789abcdef0123456789abcdef";

  afterEach(async () => {
    await clearReplayProtection(null, matchId, [userId]);
  });

  it("accepts the first seq and rejects reused seq values", async () => {
    await registerReplayNonce(null, matchId, nonce);

    await expect(
      validateReplayProtectedInput({
        matchId,
        userId,
        seq: 1,
        inputNonce: nonce,
      })
    ).resolves.toEqual({ accept: true });

    await registerAcceptedReplaySeq(null, matchId, userId, 1);

    await expect(
      validateReplayProtectedInput({
        matchId,
        userId,
        seq: 1,
        inputNonce: nonce,
      })
    ).resolves.toEqual({ accept: false, reason: "replayed_seq", lastSeq: 1 });
  });

  it("rejects missing or mismatched nonces", async () => {
    await registerReplayNonce(null, matchId, nonce);

    await expect(
      validateReplayProtectedInput({
        matchId,
        userId,
        seq: 2,
      })
    ).resolves.toEqual({ accept: false, reason: "missing_nonce" });

    await expect(
      validateReplayProtectedInput({
        matchId,
        userId,
        seq: 2,
        inputNonce: "ffffffffffffffffffffffffffffffff",
      })
    ).resolves.toEqual({ accept: false, reason: "mismatch_nonce" });
  });

  it("clears stored nonce and seq state", async () => {
    await registerReplayNonce(null, matchId, nonce);
    await registerAcceptedReplaySeq(null, matchId, userId, 5);
    await clearReplayProtection(null, matchId, [userId]);

    await expect(
      validateReplayProtectedInput({
        matchId,
        userId,
        seq: 1,
        inputNonce: nonce,
      })
    ).resolves.toEqual({ accept: true });
  });
});