/** @jest-environment node */

import {
  getGatewayGauge,
  getGatewayMetric,
  incrementGatewayMetric,
  observeGatewayHistogram,
  renderGatewayMetrics,
  resetGatewayMetrics,
  setGatewayGauge,
} from "../../services/pvp-gateway/src/metrics";

describe("gateway metrics rendering", () => {
  beforeEach(() => {
    resetGatewayMetrics();
  });

  it("renders counters, gauges, and histograms in Prometheus format", () => {
    incrementGatewayMetric("pvp_ws_outbound_messages_total", { type: "PROGRESS" }, 2);
    setGatewayGauge("pvp_active_connections", 5);
    observeGatewayHistogram("pvp_ws_batch_flush_size", 3, [1, 2, 4, 8]);
    observeGatewayHistogram("pvp_ws_batch_flush_size", 7, [1, 2, 4, 8]);

    expect(getGatewayMetric("pvp_ws_outbound_messages_total", { type: "PROGRESS" })).toBe(2);
    expect(getGatewayGauge("pvp_active_connections")).toBe(5);

    const rendered = renderGatewayMetrics();
    expect(rendered).toContain("# TYPE pvp_ws_outbound_messages_total counter");
    expect(rendered).toContain('pvp_ws_outbound_messages_total{type="PROGRESS"} 2');
    expect(rendered).toContain("# TYPE pvp_active_connections gauge");
    expect(rendered).toContain("pvp_active_connections 5");
    expect(rendered).toContain("# TYPE pvp_ws_batch_flush_size histogram");
    expect(rendered).toContain('pvp_ws_batch_flush_size_bucket{le="4"} 1');
    expect(rendered).toContain('pvp_ws_batch_flush_size_bucket{le="8"} 2');
    expect(rendered).toContain("pvp_ws_batch_flush_size_sum 10");
    expect(rendered).toContain("pvp_ws_batch_flush_size_count 2");
  });
});
