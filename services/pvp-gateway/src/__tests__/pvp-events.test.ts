/** @jest-environment node */

import { createGatewayEventBus } from "../events";
import { getGatewayMetric, renderGatewayMetrics, resetGatewayMetrics } from "../metrics";

describe("gateway event bus", () => {
  beforeEach(() => {
    resetGatewayMetrics();
  });

  it("updates metrics for invalid transitions and disconnect forfeits", () => {
    const bus = createGatewayEventBus();

    bus.emit("match:invalid-transition", {
      matchId: "m1",
      from: "countdown",
      to: "lobby",
      roomCode: null,
      atMs: 100,
    });
    bus.emit("match:ended", {
      matchId: "m1",
      from: "live",
      to: "finished",
      roomCode: null,
      atMs: 150,
      reason: "opponent_disconnected",
    });
    bus.emit("idempotency:hit", { scope: "queue_join", userId: "u1" });
    bus.emit("idempotency:miss", { scope: "queue_join", userId: "u1" });

    expect(getGatewayMetric("pvp_invalid_transitions_total", { from: "countdown", to: "lobby" })).toBe(1);
    expect(getGatewayMetric("pvp_disconnect_forfeits_total")).toBe(1);
    expect(getGatewayMetric("pvp_idempotency_cache_hits_total", { scope: "queue_join" })).toBe(1);
    expect(getGatewayMetric("pvp_idempotency_cache_misses_total", { scope: "queue_join" })).toBe(1);
    expect(renderGatewayMetrics()).toContain("pvp_disconnect_forfeits_total 1");
  });
});