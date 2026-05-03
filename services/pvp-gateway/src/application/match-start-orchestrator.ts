/**
 * @module application/match-start-orchestrator
 *
 * Single source of truth for the entire match start-sequence pipeline.
 *
 * ## Why this service exists
 *
 * Before this class, start-sequence logic was scattered across four call
 * sites in `index.ts` and `application/commands/match-join.ts`:
 * - `scheduleNoShowTimeout` (in `main()` closure)
 * - `scheduleCountdownActivation` (in `main()` closure)
 * - Countdown tick intervals via `countdownTickIntervals` Map
 * - Countdown activation timers via `countdownActivationTimers` Map
 *
 * This created several bugs:
 * - RC-1: No-show timer lost on gateway restart — not re-armed on reconnect.
 * - RC-2: `scheduleCountdownActivation` called from 4 sites with no dedup guard
 *         → duplicate timers armed on reconnect.
 * - RC-4: No startup recovery sweep for stale `countdown`/`waiting_for_both` DB rows.
 *
 * This orchestrator fixes all three by:
 * 1. Being the **only** place that arms/cancels start-sequence timers.
 * 2. Tracking which matches have which timers armed via internal `Set`s.
 * 3. Exposing `rehydrate(matchId, liveState)` that any path (reconnect, startup
 *    sweep) can call to resume the correct timer with the remaining duration.
 *
 * ## Timer model (all in-process; no Redis dependency)
 *
 * | Phase            | Timer type | Key            |
 * |------------------|-----------|----------------|
 * | waiting_for_both | No-show   | matchId        |
 * | countdown_armed  | Activation| matchId        |
 * | countdown_armed  | Tick      | matchId        |
 *
 * ## Idempotency
 * Every `arm*` / `advanceTo*` method is a no-op if the match is already at
 * or past the requested phase.  Concurrent calls for the same matchId are
 * serialised via an in-process `Set` guard checked before any side-effects.
 *
 * ## Testability
 * All timer operations are delegated to an injected `TimerService`, which is
 * backed by the real `setTimeout/clearTimeout` in production and by
 * `jest.useFakeTimers()` in tests.
 */

import type { MatchLifecycleState } from "../match-fsm";
import type { MatchLiveState } from "../match-live-state";
import type { LocalMatch } from "../shared/types";
import type { MatchId } from "../shared/branded-ids";
import type { RedisCountdownQueue, RedisDeferredTimerQueue } from "../infrastructure/redis";
import { MATCH_NO_SHOW_TIMEOUT_MS, MATCH_MAX_COUNTDOWN_AGE_MS } from "../shared/config";
import { gatewayLogInfo, gatewayLogWarn } from "../shared/logger";

// =============================================================================
// TIMER SERVICE (injectable for testing)
// =============================================================================

/**
 * Thin abstraction over `setTimeout`/`clearTimeout` + `setInterval`/`clearInterval`.
 *
 * - In production: backed by Node's global timer functions.
 * - In tests: inject a fake implementation driven by `jest.useFakeTimers()`.
 */
export interface TimerService {
  /**
   * Schedule a one-shot callback.
   * @returns An opaque handle that can be passed to `clearTimer`.
   */
  setTimer(id: string, fn: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  /** Cancel a previously scheduled timer.  No-op if `handle` is undefined. */
  clearTimer(handle: ReturnType<typeof setTimeout> | undefined): void;
  /**
   * Schedule a repeating callback.
   * @returns An opaque handle that can be passed to `clearInterval`.
   */
  setInterval(id: string, fn: () => void, intervalMs: number): ReturnType<typeof setInterval>;
  /** Cancel a previously scheduled interval.  No-op if `handle` is undefined. */
  clearInterval(handle: ReturnType<typeof setInterval> | undefined): void;
}

/**
 * Production timer service that delegates directly to Node's built-in timers.
 * Timers are `.unref()`'d so they do not keep the process alive during shutdown.
 */
export const productionTimerService: TimerService = {
  setTimer(_id, fn, delayMs) {
    const handle = setTimeout(fn, delayMs);
    if (typeof handle.unref === "function") handle.unref();
    return handle;
  },
  clearTimer(handle) {
    if (handle !== undefined) clearTimeout(handle);
  },
  setInterval(_id, fn, intervalMs) {
    const handle = setInterval(fn, intervalMs);
    if (typeof handle.unref === "function") handle.unref();
    return handle;
  },
  clearInterval(handle) {
    if (handle !== undefined) clearInterval(handle);
  },
};

// =============================================================================
// INTERNAL PER-MATCH TIMER STATE
// =============================================================================

interface MatchTimers {
  noShowHandle?: ReturnType<typeof setTimeout>;
  activationHandle?: ReturnType<typeof setTimeout>;
  tickHandle?: ReturnType<typeof setInterval>;
}

// =============================================================================
// ORCHESTRATOR CALLBACKS
// =============================================================================

/**
 * Callbacks injected from `main()` — these actions require access to `deps`
 * or other closed-over state that cannot be cleanly extracted into the
 * orchestrator without circular dependencies.
 */
export interface MatchStartCallbacks {
  /**
   * Advance the in-memory + DB match state from `waiting_for_both` to
   * `countdown` and set `serverStartAtMs`.  Returns `true` if the transition
   * was successfully applied.
   */
  advanceToCountdown: (matchId: MatchId) => Promise<boolean>;

  /**
   * Activate the countdown by transitioning the match from `countdown` to
   * `live`.  Called by the activation timer after `serverStartAtMs` has passed.
   */
  activateCountdown: (matchId: MatchId, trigger: "timer" | "sweep" | "redis-worker" | "client-sync") => Promise<void>;

  /**
   * Emit a `COUNTDOWN_TICK` message to each non-AI participant with the
   * remaining seconds before the match goes live.
   */
  sendCountdownTick: (matchId: MatchId, remainingSeconds: number) => void;

  /**
   * Abort the match with reason `"no_show"` — called when the no-show timer
   * fires and not all players have joined.
   */
  abortNoShow: (matchId: MatchId) => Promise<void>;
}

// =============================================================================
// MAIN CLASS
// =============================================================================

/**
 * `MatchStartOrchestrator` owns the entire lifecycle of a match from
 * creation to the `live` state.
 *
 * Inject once in `main()`, assign to `deps.matchStartOrchestrator`, then call:
 * - `arm(matchId, variant)` when a match is created
 * - `advanceToCountdown(matchId)` when both players have joined (ranked 1v1)
 * - `rehydrate(matchId, liveState)` when a player reconnects or on startup sweep
 * - `disarm(matchId)` when the match is aborted or finalized
 */
export class MatchStartOrchestrator {
  /** Per-match timer handles. */
  private readonly timers = new Map<MatchId, MatchTimers>();
  /**
   * Set of matchIds for which the countdown phase is already armed.
   * Acts as the idempotency guard for `armCountdown`.
   */
  private readonly countdownArmed = new Set<MatchId>();
  /** Set of matchIds for which the no-show timer is currently armed. */
  private readonly noShowArmed = new Set<MatchId>();

  constructor(
    private readonly timerSvc: TimerService,
    private callbacks: MatchStartCallbacks,
    /** Countdown tick interval in ms (default 1000ms). */
    private readonly tickIntervalMs = 1_000,
    /**
     * Optional Redis sorted-set queue for durable countdown activation.
     * When provided, `_armCountdown` enqueues the activation time so any
     * gateway instance can pick it up via the countdown worker poll loop.
     * `null` / `undefined` = in-process timers only (no Redis).
     */
    private countdownQueue: RedisCountdownQueue | null = null,
  ) {}

  /** Durable no-show deadline queue; set via `wireNoshowQueue` after construction. */
  private noshowQueue: RedisDeferredTimerQueue | null = null;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Patch the orchestrator's callbacks after initial construction.
   *
   * This is needed in `main()` to avoid a circular dependency: the orchestrator
   * is created before the closures it needs exist, so we construct it with stub
   * callbacks and patch them once the real closures are in scope.
   */
  wireCallbacks(callbacks: MatchStartCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Patch the Redis countdown queue after the orchestrator is constructed.
   *
   * Call once from `main()` after `redisBus` is initialised.
   * A `null` value disables the durable queue (in-process timers only).
   */
  wireCountdownQueue(queue: RedisCountdownQueue | null): void {
    this.countdownQueue = queue;
  }

  /**
   * Patch the durable no-show queue after the orchestrator is constructed.
   *
   * Call once from `main()` after `redisBus` is initialised.
   * When set, `_armNoShow` enqueues the deadline and `_cancelNoShow` / `disarm`
   * remove it so the poller never fires for a cleanly-cancelled match.
   */
  wireNoshowQueue(queue: RedisDeferredTimerQueue | null): void {
    this.noshowQueue = queue;
  }
  /**
   * Fire the no-show abort callback directly — used by the Redis noshow worker
   * to recover overdue entries after a gateway restart (when the in-process
   * timer was lost).
   *
   * Clears the in-process armed flag before calling `abortNoShow` so we don't
   * double-fire if `rehydrate()` has also armed a local timer.
   */
  async triggerNoShowAbort(matchId: MatchId): Promise<void> {
    // Cancel any in-process no-show timer (idempotent).
    this._cancelNoShow(matchId);
    await this.callbacks.abortNoShow(matchId);
  }
  /**
   * Arm the start-sequence for a newly created match.
   *
   * - `"ranked_human"`: arms the no-show timer (`MATCH_NO_SHOW_TIMEOUT_MS`).
   *    After that fires, if the match is still `waiting_for_both`, abort.
   * - `"ranked_ai"`: match starts in `countdown` immediately — only the
   *    countdown activation timer needs to be scheduled.
   * - `"room"`: match starts in `countdown` — only the activation timer.
   *
   * **Idempotent**: no-op if already armed for this matchId.
   */
  arm(match: LocalMatch, variant: "ranked_human" | "ranked_ai" | "room"): void {
    if (this.timers.has(match.matchId)) return; // already armed

    const entry: MatchTimers = {};
    this.timers.set(match.matchId, entry);

    if (variant === "ranked_human") {
      this._armNoShow(match.matchId, MATCH_NO_SHOW_TIMEOUT_MS);
    } else {
      // ranked_ai or room: starts in countdown, arm the activation timer directly.
      // Enforce a minimum join-buffer so the timer never fires before a nearby
      // client can send MATCH_JOIN and receive its first MATCH_STATE with the
      // correct serverStartAt.  This applies when bot-matching exhausts the
      // queue timeout and serverStartAtMs has already expired by the time arm()
      // is called (observed as serverStartDelayMs: 0 in gateway logs).
      const MIN_JOIN_BUFFER_MS = 750;
      const remaining = match.serverStartAtMs - Date.now();
      if (remaining < MIN_JOIN_BUFFER_MS) {
        // Slide serverStartAtMs forward so the client-side countdown display
        // reflects the actual activation time rather than showing an already-
        // elapsed timestamp (which would render as "0" or flash 3→1→GO).
        match.serverStartAtMs = Date.now() + MIN_JOIN_BUFFER_MS;
      }
      this._armCountdown(match, Math.max(MIN_JOIN_BUFFER_MS, remaining));
    }
  }

  /**
   * Advance from `waiting_for_both` to `countdown`.
   *
   * Called from `maybeStartRankedCountdown` when both players have sent
   * `MATCH_JOIN`.  Safe to call concurrently — only the first call arms the
   * countdown; subsequent calls are no-ops.
   *
   * @returns `true` if this call triggered the transition; `false` if it was
   *          already armed (idempotent no-op).
   */
  async advanceToCountdown(match: LocalMatch): Promise<boolean> {
    if (this.countdownArmed.has(match.matchId)) return false;
    this.countdownArmed.add(match.matchId);

    // Cancel the no-show timer — both players have arrived.
    this._cancelNoShow(match.matchId);

    const applied = await this.callbacks.advanceToCountdown(match.matchId);
    if (!applied) {
      // Transition was rejected (match may have been aborted concurrently).
      this.countdownArmed.delete(match.matchId);
      return false;
    }

    const remainingMs = match.serverStartAtMs - Date.now();
    this._armCountdown(match, remainingMs);

    gatewayLogInfo("[MatchStartOrchestrator] Countdown armed", {
      matchId: match.matchId,
      serverStartAtMs: match.serverStartAtMs,
      remainingMs: Math.max(0, remainingMs),
    });

    return true;
  }

  /**
   * Re-arm the correct timer after a gateway restart or player reconnect.
   *
   * Reads `startPhase` (or falls back to `liveState.state`) to determine
   * which timer to restore with the remaining duration.
   *
   * - `"waiting_for_both"` / `"no_show_armed"` → re-arm no-show with remaining window.
   * - `"countdown_armed"` → re-arm countdown activation with remaining window.
   * - `"live"` / already terminal → no-op.
   */
  rehydrate(match: LocalMatch, liveState: MatchLiveState): void {
    const phase = liveState.startPhase ?? this._phaseFromState(liveState.state);
    const nowMs = Date.now();

    if (phase === "live" || phase === undefined) return;
    if (liveState.state === "finished" || liveState.state === "aborted") return;

    // Ensure the entry map exists
    if (!this.timers.has(match.matchId)) {
      this.timers.set(match.matchId, {});
    }

    if (phase === "waiting_for_both" || phase === "no_show_armed") {
      if (this.noShowArmed.has(match.matchId)) return; // already armed (reconnect of second player)

      // Compute remaining no-show window from DB row's stateChangedAt.
      // `match.stateChangedAt` is the ms timestamp of the `waiting_for_both` transition.
      const elapsed = nowMs - match.stateChangedAt;
      const remaining = Math.max(1, MATCH_NO_SHOW_TIMEOUT_MS - elapsed);

      this._armNoShow(match.matchId, remaining);

      gatewayLogInfo("[MatchStartOrchestrator] Rehydrated no-show timer", {
        matchId: match.matchId,
        remainingMs: remaining,
        phase,
      });
      return;
    }

    if (phase === "countdown_armed") {
      if (this.countdownArmed.has(match.matchId)) return; // already armed

      const serverStartAtMs = liveState.serverStartAtEpochMs ?? match.serverStartAtMs;
      if (serverStartAtMs - nowMs < -MATCH_MAX_COUNTDOWN_AGE_MS) {
        // Countdown is too stale — startup sweep will abort it.
        gatewayLogWarn("[MatchStartOrchestrator] Stale countdown on rehydrate — skipping", {
          matchId: match.matchId,
          serverStartAtMs,
          ageMs: nowMs - serverStartAtMs,
        });
        return;
      }

      this.countdownArmed.add(match.matchId);
      const remaining = serverStartAtMs - nowMs;
      this._armCountdown(match, remaining);

      gatewayLogInfo("[MatchStartOrchestrator] Rehydrated countdown timer", {
        matchId: match.matchId,
        remainingMs: Math.max(0, remaining),
      });
    }
  }

  /**
   * Cancel all start-sequence timers for a match.
   *
   * Call from `abortMatchLifecycle` and `MatchCleanupService.dispose`.
   * **Idempotent** — safe to call multiple times.
   */
  disarm(matchId: MatchId): void {
    this._cancelNoShow(matchId);
    this._cancelCountdown(matchId);
    this.timers.delete(matchId);
    this.countdownArmed.delete(matchId);
    this.noShowArmed.delete(matchId);
    // Belt-and-suspenders: also remove from Redis queue in case _cancelNoShow
    // missed it (e.g. if timers entry was already absent).
    void this.noshowQueue?.remove(matchId).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _armNoShow(matchId: MatchId, delayMs: number): void {
    if (this.noShowArmed.has(matchId)) return;
    this.noShowArmed.add(matchId);

    const entry = this.timers.get(matchId) ?? {};

    entry.noShowHandle = this.timerSvc.setTimer(`no_show:${matchId}`, async () => {
      this.noShowArmed.delete(matchId);
      const e = this.timers.get(matchId);
      if (e) delete e.noShowHandle;
      await this.callbacks.abortNoShow(matchId);
    }, delayMs);

    this.timers.set(matchId, entry);

    // Durable backup: enqueue the deadline in Redis so the no-show worker
    // can fire even if this in-process timer is lost (e.g. after a crash).
    void this.noshowQueue?.enqueue(matchId, Date.now() + delayMs).catch(() => {});
  }

  private _cancelNoShow(matchId: MatchId): void {
    const entry = this.timers.get(matchId);
    if (!entry) return;
    this.timerSvc.clearTimer(entry.noShowHandle);
    delete entry.noShowHandle;
    this.noShowArmed.delete(matchId);
    // Remove from Redis so the worker won't try to cancel a match that was
    // already cleanly cancelled (both players joined → countdown).
    void this.noshowQueue?.remove(matchId).catch(() => {});
  }

  private _armCountdown(match: LocalMatch, remainingMs: number): void {
    const matchId = match.matchId;
    const entry = this.timers.get(matchId) ?? {};
    this.timers.set(matchId, entry);

    // Cancel any previous countdown timers before re-arming.
    this._cancelCountdown(matchId);

    const serverStartAtMs = match.serverStartAtMs;
    const activationDelay = Math.max(0, remainingMs);

    // Tick timer: send COUNTDOWN_TICK once per second with remaining seconds.
    // Cap displayed value at 3 so the UI always shows 3 → 2 → 1 → GO.
    entry.tickHandle = this.timerSvc.setInterval(`tick:${matchId}`, () => {
      const secsLeft = Math.ceil((serverStartAtMs - Date.now()) / 1_000);
      if (secsLeft <= 0) return; // activation timer will fire momentarily
      const capped = Math.min(secsLeft, 3);
      this.callbacks.sendCountdownTick(matchId, capped);
    }, this.tickIntervalMs);

    // Activation timer: transition to live when serverStartAtMs is reached.
    entry.activationHandle = this.timerSvc.setTimer(`activation:${matchId}`, async () => {
      this._cancelCountdown(matchId);
      await this.callbacks.activateCountdown(matchId, "timer");
    }, activationDelay);

    // Durable backup: enqueue in Redis so the countdown worker on any
    // instance can activate the match even if this timer is lost.
    void this.countdownQueue?.enqueue(matchId, Date.now() + activationDelay).catch(() => {});
  }

  private _cancelCountdown(matchId: MatchId): void {
    const entry = this.timers.get(matchId);
    if (!entry) return;
    this.timerSvc.clearTimer(entry.activationHandle);
    this.timerSvc.clearInterval(entry.tickHandle);
    delete entry.activationHandle;
    delete entry.tickHandle;
    // Remove from Redis queue so the worker won't try to re-activate a
    // match that has already been aborted or manually disarmed.
    void this.countdownQueue?.remove(matchId).catch(() => {});
  }

  /**
   * Derive a coarse start-phase from the raw FSM state when `startPhase` is
   * absent (e.g. rows written by older gateway versions).
   */
  private _phaseFromState(
    state: MatchLifecycleState,
  ): "waiting_for_both" | "countdown_armed" | "live" | undefined {
    if (state === "waiting_for_both") return "waiting_for_both";
    if (state === "countdown") return "countdown_armed";
    if (state === "live") return "live";
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Test helpers (only used in __tests__)
  // ---------------------------------------------------------------------------

  /** @internal For tests only — returns count of a specific timer type armed for a match. */
  _getTimerCount(matchId: MatchId, type: "no_show" | "countdown" | "tick"): number {
    const entry = this.timers.get(matchId);
    if (!entry) return 0;
    if (type === "no_show") return entry.noShowHandle !== undefined ? 1 : 0;
    if (type === "countdown") return entry.activationHandle !== undefined ? 1 : 0;
    if (type === "tick") return entry.tickHandle !== undefined ? 1 : 0;
    return 0;
  }

  /** @internal For tests only — returns the armed activation delay. */
  _getArmedActivationDelay(matchId: MatchId): number | undefined {
    // This is only meaningful with a recording TimerService in tests.
    void matchId;
    return undefined;
  }
}
