import { Registry } from "prom-client";

import { createGatewayMetrics } from "../observability/metrics";

describe("createGatewayMetrics", () => {
  it("renders lifecycle and websocket metrics", async () => {
    const register = new Registry();
    const metrics = createGatewayMetrics({
      enableMetrics: true,
      gateway: "pvp-gateway",
      instanceId: "gateway-test",
      register,
    });

    metrics.setConnectionsActive(7);
    metrics.recordWsMessage({ direction: "in", type: "HELLO", durationSeconds: 0.15 });
    metrics.recordWsMessage({ direction: "out", type: "MATCH_FOUND" });
    metrics.setQueueLength("ranked", 5);
    metrics.incrementWsHandshake("success");
    metrics.setLifecycle({ ready: true, draining: false });

    const output = await metrics.renderMetrics();

    expect(output).toContain("pvp_ws_connections_active");
    expect(output).toContain("pvp_ws_messages_total");
    expect(output).toContain('type="hello"');
    expect(output).toContain('type="match_found"');
    expect(output).toContain('result="success"');
    expect(output).toContain("pvp_gateway_ready");
    expect(output).toContain("pvp_gateway_draining");
  });

  it("returns an empty payload when disabled", async () => {
    const register = new Registry();
    const metrics = createGatewayMetrics({
      enableMetrics: false,
      gateway: "pvp-gateway",
      instanceId: "gateway-test",
      register,
    });

    metrics.setConnectionsActive(4);
    metrics.incrementWsHandshake("failure");

    await expect(metrics.renderMetrics()).resolves.toBe("");
  });
});