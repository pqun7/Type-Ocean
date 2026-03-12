import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

type GatewayMetricsOptions = {
  enableMetrics: boolean;
  gateway: string;
  instanceId: string;
  register?: Registry;
};

type GameMode = "ranked" | "casual";
type MatchResult = "win" | "loss" | "draw" | "abandon" | "cheat_flag" | "timeout";
type HandshakeResult = "success" | "failure" | "rejected";

function sanitizeMessageType(type: string) {
  return type.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") || "unknown";
}

function uniqueSortedBuckets(buckets: number[]) {
  return Array.from(new Set(buckets.filter((bucket) => Number.isFinite(bucket)).sort((left, right) => left - right)));
}

export function createGatewayMetrics(options: GatewayMetricsOptions) {
  const register = options.register ?? new Registry();
  const labels = {
    gateway: options.gateway,
    instance: options.instanceId,
  };

  if (options.enableMetrics && typeof setImmediate === "function") {
    collectDefaultMetrics({ register });
  }

  const wsConnectionsActive = new Gauge({
    name: "pvp_ws_connections_active",
    help: "Active websocket connections for the PvP gateway instance.",
    labelNames: ["gateway", "instance"],
    registers: [register],
  });

  const wsMessagesTotal = new Counter({
    name: "pvp_ws_messages_total",
    help: "Total websocket messages processed by direction and type.",
    labelNames: ["gateway", "instance", "type", "direction"],
    registers: [register],
  });

  const wsMessageDurationSeconds = new Histogram({
    name: "pvp_ws_message_duration_seconds",
    help: "Latency for processing websocket messages by type.",
    labelNames: ["gateway", "instance", "type"],
    buckets: uniqueSortedBuckets([0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5]),
    registers: [register],
  });

  const matchesTotal = new Counter({
    name: "pvp_matches_total",
    help: "Match outcomes and operational terminal states observed by the PvP gateway.",
    labelNames: ["gateway", "instance", "result"],
    registers: [register],
  });

  const queueLength = new Gauge({
    name: "pvp_queue_length",
    help: "Current ranked or casual queue length visible to this PvP gateway instance.",
    labelNames: ["gateway", "instance", "game_mode"],
    registers: [register],
  });

  const matchStartLatencySeconds = new Histogram({
    name: "pvp_match_start_latency_seconds",
    help: "Observed latency between queue acceptance and countdown start for a match.",
    labelNames: ["gateway", "instance", "game_mode"],
    buckets: uniqueSortedBuckets([0.25, 0.5, 1, 2.5, 5, 7.5, 10, 15]),
    registers: [register],
  });

  const cheatConfidenceSum = new Counter({
    name: "pvp_cheat_confidence_sum",
    help: "Accumulated anti-cheat confidence observed by the PvP gateway.",
    labelNames: ["gateway", "instance"],
    registers: [register],
  });

  const wsHandshakesTotal = new Counter({
    name: "pvp_ws_handshakes_total",
    help: "Websocket handshake outcomes for the PvP gateway.",
    labelNames: ["gateway", "instance", "result"],
    registers: [register],
  });

  const gatewayReady = new Gauge({
    name: "pvp_gateway_ready",
    help: "Whether the gateway is currently ready to accept normal traffic.",
    labelNames: ["gateway", "instance"],
    registers: [register],
  });

  const gatewayDraining = new Gauge({
    name: "pvp_gateway_draining",
    help: "Whether the gateway is currently draining in preparation for shutdown.",
    labelNames: ["gateway", "instance"],
    registers: [register],
  });

  function noOp() {
    return undefined;
  }

  return {
    enabled: options.enableMetrics,
    register,
    async renderMetrics() {
      if (!options.enableMetrics) return "";
      return register.metrics();
    },
    setConnectionsActive(value: number) {
      if (!options.enableMetrics) return noOp();
      wsConnectionsActive.set(labels, value);
    },
    recordWsMessage(params: { direction: "in" | "out"; type: string; durationSeconds?: number }) {
      if (!options.enableMetrics) return noOp();
      const type = sanitizeMessageType(params.type);
      wsMessagesTotal.inc({ ...labels, type, direction: params.direction });
      if (typeof params.durationSeconds === "number" && Number.isFinite(params.durationSeconds) && params.durationSeconds >= 0) {
        wsMessageDurationSeconds.observe({ ...labels, type }, params.durationSeconds);
      }
    },
    setQueueLength(gameMode: GameMode, value: number) {
      if (!options.enableMetrics) return noOp();
      queueLength.set({ ...labels, game_mode: gameMode }, value);
    },
    observeMatchStartLatency(gameMode: GameMode, valueSeconds: number) {
      if (!options.enableMetrics) return noOp();
      if (!Number.isFinite(valueSeconds) || valueSeconds < 0) return noOp();
      matchStartLatencySeconds.observe({ ...labels, game_mode: gameMode }, valueSeconds);
    },
    incrementMatchResult(result: MatchResult, amount = 1) {
      if (!options.enableMetrics) return noOp();
      if (!Number.isFinite(amount) || amount <= 0) return noOp();
      matchesTotal.inc({ ...labels, result }, amount);
    },
    addCheatConfidence(confidence: number) {
      if (!options.enableMetrics) return noOp();
      if (!Number.isFinite(confidence) || confidence <= 0) return noOp();
      cheatConfidenceSum.inc(labels, confidence);
    },
    incrementWsHandshake(result: HandshakeResult) {
      if (!options.enableMetrics) return noOp();
      wsHandshakesTotal.inc({ ...labels, result });
    },
    setLifecycle(params: { ready: boolean; draining: boolean }) {
      if (!options.enableMetrics) return noOp();
      gatewayReady.set(labels, params.ready ? 1 : 0);
      gatewayDraining.set(labels, params.draining ? 1 : 0);
    },
  };
}

export type GatewayMetrics = ReturnType<typeof createGatewayMetrics>;