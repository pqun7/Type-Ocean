import type { WebSocketServer } from "ws";

import { createAiProfile, estimatePlayerSkill, mulberry32 } from "./ai";
import { buildProgressPayload } from "./match-sync";
import type { MatchCache } from "./match-cache";
import type { MatchRepository } from "./match-repository";
import type { InMemoryState } from "./state";
import { incrementGatewayMetric, setGatewayGauge } from "./metrics";
import type { GatewayDb } from "./gateway-db";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

type AdaptiveAiParams = {
  prisma: GatewayDb;
  wss: WebSocketServer;
  matchCache: MatchCache | null;
  matchRepository: MatchRepository;
  matchId: string;
  humanId: string;
  aiUserId: string;
  snapshotIntervalMs: number;
  state: InMemoryState;
  forceFinishHumanAfterMs?: number;
  onFinalizeMatchIfComplete: (matchId: string) => Promise<void>;
  onBroadcastMatchSnapshot: (matchId: string, nowMs: number, intervalMs: number) => boolean;
};

/**
 * Runs adaptive AI simulation with bounded DB persistence cadence.
 */
export async function startAiSimulationAdaptive(params: AdaptiveAiParams) {
  const match = params.state.matches.get(params.matchId);
  if (!match) return;

  const ai = match.participants.get(params.aiUserId);
  const human = match.participants.get(params.humanId);
  if (!ai || !human) return;

  const skill = await estimatePlayerSkill(params.prisma, params.humanId);
  const seed = Array.from(params.matchId).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const rand = mulberry32(seed);
  const profile = createAiProfile(skill, Math.floor(rand() * 1_000_000));

  const shouldForceFinishHuman = (params.forceFinishHumanAfterMs ?? 30_000) > 0;
  const forceFinishDelayMs = params.forceFinishHumanAfterMs ?? 30_000;

  const BASE_TICK_MS = envInt("PVP_AI_BASE_TICK_MS", 125);
  const MAX_TICK_MS = envInt("PVP_AI_MAX_TICK_MS", 280);
  const MIN_FLUSH_MS = envInt("PVP_AI_MIN_FLUSH_MS", 650);
  const MAX_FLUSH_MS = envInt("PVP_AI_MAX_FLUSH_MS", 2600);
  const TELEMETRY_LIMIT = 40;
  const OVERLOAD_EVENT_LOOP_LAG_MS = envInt("PVP_AI_OVERLOAD_EVENT_LOOP_LAG_MS", 55);
  const OVERLOAD_DB_WRITE_MS = envInt("PVP_AI_OVERLOAD_DB_WRITE_MS", 12);
  const OVERLOAD_AI_MATCH_COUNT = envInt("PVP_AI_OVERLOAD_AI_MATCH_COUNT", 550);
  const LOAD_SCORE_EVENT_LOOP_DIVISOR = envInt("PVP_AI_LOAD_SCORE_EVENT_LOOP_DIVISOR", 55);
  const LOAD_SCORE_DB_WRITE_DIVISOR = envInt("PVP_AI_LOAD_SCORE_DB_WRITE_DIVISOR", 12);
  const LOAD_SCORE_AI_COUNT_DIVISOR = envInt("PVP_AI_LOAD_SCORE_AI_COUNT_DIVISOR", 550);
  const OVERLOAD_TICK_MULTIPLIER = envNumber("PVP_AI_OVERLOAD_TICK_MULTIPLIER", 1.25);
  const OVERLOAD_FLUSH_MULTIPLIER = envNumber("PVP_AI_OVERLOAD_FLUSH_MULTIPLIER", 1.18);
  const RECOVERY_TICK_MULTIPLIER = envNumber("PVP_AI_RECOVERY_TICK_MULTIPLIER", 0.88);
  const RECOVERY_BASE_WEIGHT = envNumber("PVP_AI_RECOVERY_BASE_WEIGHT", 0.12);
  const RECOVERY_FLUSH_MULTIPLIER = envNumber("PVP_AI_RECOVERY_FLUSH_MULTIPLIER", 0.9);

  let currentTickMs = BASE_TICK_MS;
  let currentFlushMs = MIN_FLUSH_MS;
  let speedFactor = 1;
  let expectedRevision = match.revision;
  let dirtySinceFlush = false;
  let lastDbWriteDurationMs = 0;
  let consecutiveDbFailures = 0;
  let lastFlushAtMs = Date.now();
  let lastTickStartNs = process.hrtime.bigint();
  let telemetryCasConflicts = 0;
  let telemetryLockWaits = 0;
  let dbFlushCount = 0;
  let consecutiveSkips = 0;

  const maxSpeedFactor = 1.16;
  const minSpeedFactor = 0.84;

  const stopSimulation = () => {
    params.state.clearAiInterval(params.matchId);
    params.matchCache?.clearAiTickState(params.matchId);
  };

  const persistAiProgress = async (nowMs: number, force = false) => {
    if (!dirtySinceFlush && !force) return true;
    if (!force && nowMs - lastFlushAtMs < currentFlushMs) return true;

    const currentMatch = params.state.matches.get(params.matchId);
    const currentAi = currentMatch?.participants.get(params.aiUserId);
    if (!currentMatch || !currentAi) return false;

    const writeStartedNs = process.hrtime.bigint();

    try {
      const applied = await params.matchRepository.updateAiProgress(params.matchId, expectedRevision, {
        userId: currentAi.userId,
        input: currentAi.input,
        seq: currentAi.seq,
        errors: currentAi.errors,
        wpm: currentAi.wpm,
        accuracy: currentAi.accuracy,
        finishedAt: currentAi.finishedAt,
        lastInputAtMs: nowMs,
      });

      lastDbWriteDurationMs = Number(process.hrtime.bigint() - writeStartedNs) / 1_000_000;
      if (lastDbWriteDurationMs > 8 && telemetryLockWaits < TELEMETRY_LIMIT) {
        telemetryLockWaits += 1;
        incrementGatewayMetric("pvp_ai_lock_wait_total", { bucket: "db_write_slow" });
      }

      if (!applied) {
        if (telemetryCasConflicts < TELEMETRY_LIMIT) {
          telemetryCasConflicts += 1;
          incrementGatewayMetric("pvp_ai_revision_conflict_total", { reason: "cas_conflict" });
        }

        const latest = await params.matchRepository.load(params.matchId);
        if (!latest) return false;
        expectedRevision = latest.revision;
        return false;
      }

      expectedRevision += 1;
      currentMatch.revision = expectedRevision;
      dirtySinceFlush = false;
      lastFlushAtMs = nowMs;
      consecutiveDbFailures = 0;
      consecutiveSkips = 0;
      dbFlushCount += 1;
      incrementGatewayMetric("pvp_ai_db_flush_total", { mode: "adaptive" });
      return true;
    } catch {
      consecutiveDbFailures += 1;
      incrementGatewayMetric("pvp_ai_db_write_failed_total", { phase: "update_ai_progress" });
      if (consecutiveDbFailures >= 3) {
        stopSimulation();
        return false;
      }
      consecutiveSkips += 1;
      return false;
    }
  };

  const scheduleNextTick = () => {
    const timeout = setTimeout(() => {
      void tick();
    }, currentTickMs);

    if (typeof timeout.unref === "function") {
      timeout.unref();
    }

    params.state.aiIntervals.set(params.matchId, timeout);
  };

  const tick = async () => {
    const current = params.state.matches.get(params.matchId);
    if (!current) {
      stopSimulation();
      return;
    }

    const nowMs = Date.now();
    const tickStartNs = process.hrtime.bigint();
    const tickDeltaMs = Number(tickStartNs - lastTickStartNs) / 1_000_000;
    const eventLoopLagMs = Math.max(0, tickDeltaMs - currentTickMs);
    lastTickStartNs = tickStartNs;

    if (nowMs < current.serverStartAtMs) {
      scheduleNextTick();
      return;
    }

    if (current.state === "countdown") {
      current.state = "live";
      current.status = "RUNNING";
      current.stateChangedAt = nowMs;
    }

    if (current.state !== "live") {
      stopSimulation();
      return;
    }

    const aiNow = current.participants.get(params.aiUserId);
    const humanNow = current.participants.get(params.humanId);
    if (!aiNow || !humanNow) {
      stopSimulation();
      return;
    }

    const gap = humanNow.input.length - aiNow.input.length;
    const desiredAdjust = clamp(gap / 1200, -0.06, 0.06);
    speedFactor = clamp(speedFactor + desiredAdjust, minSpeedFactor, maxSpeedFactor);

    const wobble = 1 + (rand() - 0.5) * 2 * profile.volatility;
    const effectiveWpm = clamp(profile.targetWpm * speedFactor * wobble, 10, 260);

    const elapsedSec = (nowMs - current.serverStartAtMs) / 1000;
    const charsPerSec = (effectiveWpm * 5) / 60;
    const targetChars = Math.floor(charsPerSec * elapsedSec);

    let nextIndex = clamp(targetChars, 0, current.textSnapshot.length);
    if (rand() < 0.03 && nextIndex > 6) {
      nextIndex = Math.max(0, nextIndex - (1 + Math.floor(rand() * 3)));
    }

    nextIndex = Math.min(current.textSnapshot.length, Math.max(aiNow.input.length - 3, Math.min(aiNow.input.length + 12, nextIndex)));

    aiNow.input = current.textSnapshot.slice(0, nextIndex);
    aiNow.seq += 1;
    aiNow.errors = Math.max(0, Math.round(((100 - profile.accuracyPct) / 100) * aiNow.input.length * 0.08));
    aiNow.accuracy = clamp(profile.accuracyPct - (rand() * 1.2), 80, 99.9);
    aiNow.wpm = Math.round(effectiveWpm);
    aiNow.lastInputAtMs = nowMs;

    if (aiNow.input.length >= current.textSnapshot.length && aiNow.finishedAt == null) {
      aiNow.finishedAt = nowMs;

      if (shouldForceFinishHuman) {
        const forceTimeout = setTimeout(() => {
          const mm = params.state.matches.get(params.matchId);
          if (!mm) return;
          const h = mm.participants.get(params.humanId);
          if (!h) return;
          if (mm.state !== "live") return;
          if (h.finishedAt != null) return;

          h.finishedAt = Date.now();
          void params.onFinalizeMatchIfComplete(mm.matchId);
        }, forceFinishDelayMs);

        if (typeof forceTimeout.unref === "function") {
          forceTimeout.unref();
        }
      }
    }

    dirtySinceFlush = true;

    const progressPayload = buildProgressPayload(current, aiNow, nowMs);
    params.matchCache?.broadcastProgress(current.matchId, progressPayload);
    params.onBroadcastMatchSnapshot(current.matchId, nowMs, params.snapshotIntervalMs);

    if (aiNow.finishedAt != null) {
      await persistAiProgress(nowMs, true);
      await params.onFinalizeMatchIfComplete(current.matchId);
      stopSimulation();
      return;
    }

    const persisted = await persistAiProgress(nowMs, false);
    if (!persisted) {
      consecutiveSkips += 1;
    }

    const aiCount = params.matchCache?.getActiveAiMatchCount() ?? 0;
    const loadScore = Number(
      ((eventLoopLagMs / LOAD_SCORE_EVENT_LOOP_DIVISOR) +
        (lastDbWriteDurationMs / LOAD_SCORE_DB_WRITE_DIVISOR) +
        (aiCount / LOAD_SCORE_AI_COUNT_DIVISOR)).toFixed(3)
    );
    const overloaded =
      eventLoopLagMs > OVERLOAD_EVENT_LOOP_LAG_MS ||
      lastDbWriteDurationMs > OVERLOAD_DB_WRITE_MS ||
      aiCount > OVERLOAD_AI_MATCH_COUNT;
    if (overloaded) {
      currentTickMs = Math.min(MAX_TICK_MS, Math.round(currentTickMs * OVERLOAD_TICK_MULTIPLIER));
      currentFlushMs = Math.min(MAX_FLUSH_MS, Math.round(currentFlushMs * OVERLOAD_FLUSH_MULTIPLIER));
    } else {
      currentTickMs = Math.max(
        BASE_TICK_MS,
        Math.round(currentTickMs * RECOVERY_TICK_MULTIPLIER + BASE_TICK_MS * RECOVERY_BASE_WEIGHT)
      );
      currentFlushMs = Math.max(MIN_FLUSH_MS, Math.round(currentFlushMs * RECOVERY_FLUSH_MULTIPLIER));
    }

    params.matchCache?.setAiTickState(params.matchId, {
      tickMs: currentTickMs,
      lastFlushAtMs,
    });

    setGatewayGauge("pvp_ai_current_interval_ms", currentTickMs);
    setGatewayGauge("pvp_ai_db_flush_count", dbFlushCount);
    setGatewayGauge("pvp_ai_load_score", loadScore);
    setGatewayGauge("pvp_ai_consecutive_skips", consecutiveSkips);

    scheduleNextTick();
  };

  params.matchCache?.setAiTickState(params.matchId, {
    tickMs: currentTickMs,
    lastFlushAtMs,
  });

  scheduleNextTick();
}
