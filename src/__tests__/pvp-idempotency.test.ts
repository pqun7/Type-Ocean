/** @jest-environment node */

import { buildIdempotencyKey, getIdempotencyTtlSeconds, InMemoryIdempotencyStore } from "../../services/pvp-gateway/src/idempotency";
import { createLocalLock } from "../../services/pvp-gateway/src/local-lock";

describe("pvp idempotency and locks", () => {
  it("stores and expires in-memory idempotency entries", () => {
    const store = new InMemoryIdempotencyStore();
    const key = buildIdempotencyKey("u1", "MATCH_JOIN", "req-123456");

    store.set(key, { response: { type: "MATCH_STATE", payload: { ok: true } } }, 1, 1_000);

    expect(store.get(key, 1_500)).toEqual({ response: { type: "MATCH_STATE", payload: { ok: true } } });
    expect(store.get(key, 2_001)).toBeNull();
    expect(getIdempotencyTtlSeconds("INPUT_UPDATE")).toBe(60);
    expect(getIdempotencyTtlSeconds("ROOM_JOIN")).toBe(300);
  });

  it("serializes local lock work", async () => {
    const lock = createLocalLock();
    const order: string[] = [];

    await Promise.all([
      lock.runExclusive(async () => {
        order.push("a-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("a-end");
      }),
      lock.runExclusive(async () => {
        order.push("b-start");
        order.push("b-end");
      }),
    ]);

    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });
});