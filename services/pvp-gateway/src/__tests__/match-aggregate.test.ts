/**
 * @file match-aggregate.test.ts
 *
 * Unit tests for MatchAggregate — the Command Bus + Aggregate Root (P2/P4).
 *
 * Tests verify:
 * 1. Two concurrent INPUT_UPDATE dispatches execute in-order (no torn state).
 * 2. Errors thrown by a handler propagate out of dispatch() correctly.
 * 3. Concurrent FINALIZE_COMPLETE + INPUT_UPDATE: finalization sees complete state.
 * 4. Dispatches for different matchIds run in parallel (no cross-match blocking).
 * 5. MatchConflictError carries the correct matchId and operation fields.
 */

import { MatchLockRegistry } from "../domain/match/match-lock";
import {
  MatchAggregate,
  MatchConflictError,
  type MatchCommandHandlers,
} from "../domain/match/match-aggregate";
import type { MatchId } from "../shared/branded-ids";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mid(id: string): MatchId {
  return id as MatchId;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build a MatchAggregate with jest.fn() stubs for all handlers. */
function makeAggregate(overrides: Partial<MatchCommandHandlers> = {}): {
  aggregate: MatchAggregate;
  handlers: MatchCommandHandlers;
} {
  const handlers: MatchCommandHandlers = {
    inputUpdate:      jest.fn().mockResolvedValue(undefined),
    startCountdown:   jest.fn().mockResolvedValue(undefined),
    finalizeComplete: jest.fn().mockResolvedValue(undefined),
    abort:            jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const aggregate = new MatchAggregate(new MatchLockRegistry(), handlers);
  return { aggregate, handlers };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MatchAggregate", () => {
  // ------------------------------------------------------------------ test 1
  it("serialises two concurrent INPUT_UPDATE dispatches for the same match", async () => {
    const matchId = mid("agg-1");
    const log: string[] = [];

    const { aggregate } = makeAggregate({
      inputUpdate: jest.fn().mockImplementation(async (cmd) => {
        log.push(`${cmd.seq}:start`);
        await delay(20);
        log.push(`${cmd.seq}:end`);
      }),
    });

    const p1 = aggregate.dispatch({ type: "INPUT_UPDATE", matchId, userId: "u1", input: "a", seq: 1, nowMs: 0 });
    const p2 = aggregate.dispatch({ type: "INPUT_UPDATE", matchId, userId: "u1", input: "ab", seq: 2, nowMs: 1 });

    await Promise.all([p1, p2]);

    expect(log).toEqual(["1:start", "1:end", "2:start", "2:end"]);
  });

  // ------------------------------------------------------------------ test 2
  it("propagates handler errors out of dispatch()", async () => {
    const matchId = mid("agg-2");
    const boom = new Error("handler-error");

    const { aggregate } = makeAggregate({
      abort: jest.fn().mockRejectedValue(boom),
    });

    await expect(
      aggregate.dispatch({ type: "ABORT", matchId }),
    ).rejects.toThrow("handler-error");
  });

  // ------------------------------------------------------------------ test 3
  it("releases the lock after a handler error, allowing next dispatch to proceed", async () => {
    const matchId = mid("agg-3");
    const log: string[] = [];

    const { aggregate } = makeAggregate({
      inputUpdate: jest.fn()
        .mockImplementationOnce(async () => {
          log.push("first");
          throw new Error("first-failure");
        })
        .mockImplementationOnce(async () => {
          log.push("second");
        }),
    });

    const p1 = aggregate.dispatch({ type: "INPUT_UPDATE", matchId, userId: "u1", input: "a", seq: 1, nowMs: 0 });
    const p2 = aggregate.dispatch({ type: "INPUT_UPDATE", matchId, userId: "u1", input: "ab", seq: 2, nowMs: 1 });

    await expect(p1).rejects.toThrow("first-failure");
    await expect(p2).resolves.toBeUndefined();

    expect(log).toEqual(["first", "second"]);
  });

  // ------------------------------------------------------------------ test 4
  it("dispatches for different matchIds run in parallel (no cross-match blocking)", async () => {
    const mid1 = mid("agg-4a");
    const mid2 = mid("agg-4b");
    let maxConcurrency = 0;
    let currentConcurrency = 0;

    const { aggregate } = makeAggregate({
      inputUpdate: jest.fn().mockImplementation(async () => {
        currentConcurrency++;
        maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
        await delay(30);
        currentConcurrency--;
      }),
    });

    await Promise.all([
      aggregate.dispatch({ type: "INPUT_UPDATE", matchId: mid1, userId: "u1", input: "a", seq: 1, nowMs: 0 }),
      aggregate.dispatch({ type: "INPUT_UPDATE", matchId: mid2, userId: "u2", input: "b", seq: 1, nowMs: 0 }),
    ]);

    // Both handlers should have been executing concurrently.
    expect(maxConcurrency).toBe(2);
  });

  // ------------------------------------------------------------------ test 5
  it("concurrent FINALIZE_COMPLETE and INPUT_UPDATE are serialised", async () => {
    const matchId = mid("agg-5");
    const log: string[] = [];

    // The inputUpdate handler delays, simulating in-progress keystroke work.
    // finalizeComplete is submitted concurrently — it must wait for inputUpdate.
    const { aggregate } = makeAggregate({
      inputUpdate: jest.fn().mockImplementation(async () => {
        log.push("input:start");
        await delay(40);
        log.push("input:end");
      }),
      finalizeComplete: jest.fn().mockImplementation(async () => {
        log.push("finalize");
      }),
    });

    const pInput    = aggregate.dispatch({ type: "INPUT_UPDATE",      matchId, userId: "u1", input: "hello", seq: 1, nowMs: 0 });
    const pFinalize = aggregate.dispatch({ type: "FINALIZE_COMPLETE", matchId });

    await Promise.all([pInput, pFinalize]);

    // Finalize must always run after the last INPUT_UPDATE — the lock guarantees it.
    expect(log).toEqual(["input:start", "input:end", "finalize"]);
  });

  // ------------------------------------------------------------------ test 6
  it("MatchConflictError carries correct matchId and operation", () => {
    const matchId = mid("agg-6");
    const err = new MatchConflictError(matchId, "start_countdown");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MatchConflictError);
    expect(err.matchId).toBe(matchId);
    expect(err.operation).toBe("start_countdown");
    expect(err.name).toBe("MatchConflictError");
    expect(err.message).toContain("start_countdown");
  });
});
