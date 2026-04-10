/**
 * @module application
 *
 * Barrel re-export for the PvP gateway application layer.
 *
 * Import from individual modules when you need a subset; import from here
 * when wiring up the full runtime.
 */

export type { GatewayDeps } from "./deps";

export {
  buildLiveStateFromLocalMatch,
  appendMatchDelta,
  findActiveMatchByUserId,
  applyMatchTransition,
  getDisconnectForfeitKey,
} from "./match-state";

export {
  tryBeginMatchFinalization,
  endMatchFinalization,
  runWithMatchFinalizationLock,
  clearScheduledMatchCleanup,
  scheduleMatchCleanup,
  maybeBroadcastMatchSnapshot,
  loadIdempotencyHit,
  storeIdempotencyHit,
  withMatchLock,
} from "./match-helpers";

export {
  touchRoomExpiry,
  transferRoomHostIfNeeded,
  loadRoomStatePayload,
  broadcastRoomState,
  sweepRoomLifecycle,
  restoreRoomAfterMatch,
  type RoomStatePayload,
} from "./room-helpers";

export {
  tryBeginMatchFinalizationWithDbLock,
  clearTerminalMatchLiveState,
  finalizeMatchResults,
  finalizeMatchIfComplete,
} from "./finalize-match";

export { finalizeMatchByDisconnectForfeit } from "./disconnect-handler";

export {
  MatchStartOrchestrator,
  productionTimerService,
  type TimerService,
  type MatchStartCallbacks,
} from "./match-start-orchestrator";

export { abortMatchLifecycle } from "./abort-match";

export {
  buildMatchFoundPlayerPayload,
  startRoomMatch,
  createRanked1v1Match,
} from "./create-match";
