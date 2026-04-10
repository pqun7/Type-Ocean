import { EventEmitter } from "events";

import { incrementGatewayMetric } from "./metrics";
import type { MatchLifecycleState } from "./match-fsm";

type MatchTransitionEvent = {
  matchId: string;
  from: MatchLifecycleState;
  to: MatchLifecycleState;
  roomCode: string | null;
  atMs: number;
};

type MatchFinishedEvent = MatchTransitionEvent & {
  reason: "completed" | "opponent_disconnected" | "aborted" | "no_show";
};

type PlayerEvent = {
  matchId: string;
  userId: string;
  roomCode: string | null;
  atMs: number;
};

export type GatewayEventMap = {
  "player:joined": PlayerEvent;
  "player:left": PlayerEvent & {
    disconnected: boolean;
    forfeitApplied?: boolean;
  };
  "match:countdown": MatchTransitionEvent;
  "match:live": MatchTransitionEvent;
  "match:ended": MatchFinishedEvent;
  "match:finished": MatchFinishedEvent;
  "match:invalid-transition": MatchTransitionEvent;
  "idempotency:hit": {
    scope: string;
    userId?: string;
  };
  "idempotency:miss": {
    scope: string;
    userId?: string;
  };
  /**
   * Emitted by `MatchStartOrchestrator` whenever a match advances to a new
   * start-sequence phase.  Feeds the `pvp_match_start_phase_total` Prometheus
   * counter (see `registerGatewayMetricListeners`).
   */
  "match:start-phase": {
    matchId: string;
    variant: "ranked_human" | "ranked_ai" | "room";
    phase: "waiting_for_both" | "no_show_armed" | "countdown_armed" | "live" | "aborted";
    atMs: number;
  };
  /** Emitted when a stale match is recovered and timer is re-armed on startup sweep. */
  "match:start-rehydrated": { matchId: string; phase: string; atMs: number };
};

export class GatewayEventBus {
  private readonly emitter = new EventEmitter();

  on<K extends keyof GatewayEventMap>(eventName: K, listener: (payload: GatewayEventMap[K]) => void) {
    this.emitter.on(eventName, listener);
    return () => this.emitter.off(eventName, listener);
  }

  emit<K extends keyof GatewayEventMap>(eventName: K, payload: GatewayEventMap[K]) {
    this.emitter.emit(eventName, payload);
  }
}

export function createGatewayEventBus() {
  const bus = new GatewayEventBus();
  registerGatewayMetricListeners(bus);

  // Future persistence hook:
  // bus.on("match:finished", (event) => {
  //   // A later phase can persist critical lifecycle events to Redis/db here
  //   // once distributed authoritative state is introduced.
  // });

  return bus;
}

export function registerGatewayMetricListeners(bus: GatewayEventBus) {
  bus.on("match:invalid-transition", ({ from, to }) => {
    incrementGatewayMetric("pvp_invalid_transitions_total", { from, to });
  });

  bus.on("match:ended", ({ reason }) => {
    if (reason === "opponent_disconnected") {
      incrementGatewayMetric("pvp_disconnect_forfeits_total");
    }
  });

  bus.on("idempotency:hit", ({ scope }) => {
    incrementGatewayMetric("pvp_idempotency_cache_hits_total", { scope });
  });

  bus.on("idempotency:miss", ({ scope }) => {
    incrementGatewayMetric("pvp_idempotency_cache_misses_total", { scope });
  });

  bus.on("match:start-phase", ({ variant, phase }) => {
    incrementGatewayMetric("pvp_match_start_phase_total", { variant, phase });
  });

  bus.on("match:start-rehydrated", ({ phase }) => {
    incrementGatewayMetric("pvp_startup_recovery_total", { action: "rehydrated", phase });
  });
}