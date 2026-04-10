/**
 * @module application/deps
 *
 * Dependency container for the PvP gateway application layer.
 *
 * `GatewayDeps` is the single "god object" that carries all runtime services,
 * mutable state collections, configuration values, and callback functions
 * extracted from `main()` closures.  It is created once in `main()` and
 * threaded through every command handler and use-case function.
 *
 * ## Design rules
 * - Every field is **explicitly typed** — no `any`.
 * - Mutable primitive state (booleans/numbers that can be updated after init)
 *   uses a `{ value: T }` wrapper so mutation is visible at call sites.
 * - Callbacks listed here are closed-over functions from `main()` that depend
 *   on timer handles or other local state that cannot be externalised cleanly.
 *
 * ## Import policy
 * This module imports **types only** from the rest of the codebase so that
 * it introduces no runtime side-effects.
 */

import type { WebSocketServer } from "ws";
import type { GatewayDb } from "../gateway-db";
import type { RedisBus } from "../redis-bus";
import type { InMemoryState, ConnectionUser } from "../state";
import type { MatchCache } from "../match-cache";
import type { MatchRepository } from "../match-repository";
import type { MatchLockRegistry } from "../domain/match/match-lock";
import type { MatchCleanupService } from "../domain/match/match-cleanup";
import type { UserCache } from "../user-cache";
import type { createMessageBatcher } from "../message-batcher";
import type { createGatewayEventBus } from "../events";
import type { GatewayMetrics } from "../observability/metrics";
import type { GatewayHealthController } from "../health";
import type { InMemoryIdempotencyStore } from "../idempotency";
import type { WsConn } from "../presentation/ws-conn";
import type { MatchId } from "../shared/branded-ids";
import type { LocalMatch, PendingInputUpdateBatch } from "../shared/types";
import type { LocalLock } from "../local-lock";
import type { IQueueAdapter } from "../matchmaking/queue-adapter";
import type { MatchStartOrchestrator } from "./match-start-orchestrator";

// =============================================================================
// GATEWAY DEPS
// =============================================================================

export interface GatewayDeps {
  // ---------------------------------------------------------------------------
  // Core services
  // ---------------------------------------------------------------------------

  /** Drizzle database client for the gateway. */
  db: GatewayDb;
  /** Redis pub/sub + cache bus — `null` when `PVP_USE_REDIS=false`. */
  redisBus: RedisBus | null;
  /** In-process in-memory match/queue state. */
  state: InMemoryState;
  /** WebSocket socket-to-match/room index — `null` when not initialised. */
  matchCache: MatchCache | null;
  /** Short-lived user profile cache — `null` when not initialised. */
  connectionUserCache: UserCache<ConnectionUser> | null;
  /** The `ws` WebSocket server accepting client connections. */
  wss: WebSocketServer;
  /** Message batcher for coalescing outbound WS frames — `null` when off. */
  messageBatcher: ReturnType<typeof createMessageBatcher<WsConn>> | null;
  /** Low-level match DB repository. */
  matchRepository: MatchRepository;
  /** Per-match FIFO exclusive lock registry (P4). */
  matchLockRegistry: MatchLockRegistry | null;
  /** Centralised per-match resource disposal service (P3). */
  matchCleanupService: MatchCleanupService | null;
  /**
   * Authoritative orchestrator for the match start-sequence pipeline.
   * Owns no-show timers, countdown tick intervals, and activation timers.
   * Replaces all scattered `scheduleCountdownActivation` / `scheduleNoShowTimeout`
   * call sites.  `null` until assigned in `main()` before the WS server starts.
   */
  matchStartOrchestrator: MatchStartOrchestrator | null;
  /** Internal typed event bus. */
  eventBus: ReturnType<typeof createGatewayEventBus>;
  /** Prometheus / OpenMetrics recorder — `null` when metrics are disabled. */
  gatewayMetrics: GatewayMetrics | null;
  /** HTTP health controller for readiness/liveness probes. */
  gatewayHealthController: GatewayHealthController | null;
  /** In-process idempotency key store (Redis-backed when Redis is available). */
  idempotencyStore: InMemoryIdempotencyStore;

  // ---------------------------------------------------------------------------
  // Mutable state collections  (Maps / Sets shared across handlers)
  // ---------------------------------------------------------------------------

  /** Active disconnect-forfeit timers keyed by `matchId:userId`. */
  disconnectForfeitTimers: Map<string, NodeJS.Timeout>;
  /** Active no-show timers keyed by `matchId`. */
  noShowTimers: Map<string, NodeJS.Timeout>;
  /** Active match sessions keyed by `matchId:userId`. */
  activeMatchSessions: Map<string, WsConn>;
  /** Set of matchIds for which a rematch has already been created. */
  rematchStartedByMatchId: Set<string>;
  /** Pending input-update batches awaiting flush, keyed by matchId. */
  pendingInputUpdatesByMatch: Map<string, PendingInputUpdateBatch>;
  /** Retry counts for failed input-update batch flushes, keyed by matchId. */
  inputUpdateFlushRetriesByMatch: Map<string, number>;
  /** Last room-action timestamps keyed by `roomCode:userId` for cooldown. */
  roomActionLastSeen: Map<string, number>;
  /** In-flight MATCH_JOIN counts keyed by `matchId:userId`. */
  inFlightMatchJoins: Map<string, number>;
  /** Set of matchIds currently undergoing finalization (no-reentry guard). */
  matchFinalizationLocks: Set<MatchId>;
  /** Scheduled cleanup timers keyed by `MatchId`. */
  matchCleanupTimers: Map<MatchId, NodeJS.Timeout>;
  /** Pending tie-window finalization timers keyed by `matchId` string. */
  firstPlaceFinalizationTimers: Map<string, NodeJS.Timeout>;
  /** Per-match set of userIds who accepted the current rematch offer. */
  rematchAcceptedByMatchId: Map<string, Set<string>>;
  /** Last-touched timestamps for rematch accept state (TTL sweep). */
  rematchAcceptedTouchedAtByMatchId: Map<string, number>;
  /** AI-rematch cooldown expiry timestamps keyed by human userId. */
  aiRematchRefuseUntilByHumanId: Map<string, number>;

  // ---------------------------------------------------------------------------
  // Mutable primitive flags  (wrapped as { value } to allow pass-by-reference)
  // ---------------------------------------------------------------------------

  /**
   * Whether the `pvp_matchmaking_preferences` table exists in the DB.
   * `null` = not yet checked; `false` = confirmed missing (retry after TTL).
   */
  hasPvpMatchmakingPreferenceTable: { value: boolean | null };
  /** Timestamp (ms) of the last preference-table existence check. */
  pvpMatchmakingPreferenceTableLastCheckedAt: { value: number };

  // ---------------------------------------------------------------------------
  // Runtime constants  (computed from env vars once in main())
  // ---------------------------------------------------------------------------

  /** Unique identifier for this gateway instance. */
  instanceId: string;
  /** Whether it is safe to proceed even if participant DB rows couldn't be inserted. */
  allowParticipantPersistFallback: boolean;
  /** `true` when `PVP_TEST_FORCE_BOT_MATCH=1` in dev mode. */
  testForceBotMatch: boolean;
  /** `true` when `PVP_TEST_BYPASS_AUTH=true` and not in production. */
  testBypass: boolean;
  /** Timeout (ms) after which an unmatched queue-join falls back to AI. */
  aiQueueTimeoutMs: number;
  /** Maximum retries for a failed INPUT_UPDATE batch flush. */
  inputUpdateFlushMaxRetries: number;
  /** Maximum number of queued INPUT_UPDATE events before early flush. */
  inputUpdateFlushMaxEnqueued: number;
  /** Maximum number of progress deltas replayed on MATCH_JOIN reconnect. */
  matchResumeDeltaLimit: number;
  /** Grace (ms) before re-scheduling a forfeit when a MATCH_JOIN is in-flight. */
  disconnectForfeitJoinDeferMs: number;
  /** Periodic WS snapshot interval (ms). */
  matchSnapshotIntervalMs: number;
  /** Cooldown (ms) between room-action messages from the same user. */
  roomActionCooldownMs: number;
  /** Redis key prefix for online presence markers. */
  onlineKeyPrefix: string;
  /** TTL (seconds) for online presence keys. */
  onlineTtlSec: number;
  /** How often (ms) presence keys are refreshed (~1/3 of TTL). */
  presenceRefreshMs: number;
  /** Redis sorted-set key prefix for ranked matchmaking. */
  queueKeyPrefix: string;
  /** Redis key prefix for per-user queue metadata. */
  queueMetaKeyPrefix: string;
  /** Initial Elo rating range for queue matching. */
  queueRatingRange: number;
  /** TTL (ms) for rematch-accepted state. */
  rematchAcceptedTtlMs: number;
  /** Cooldown (ms) before a human can rematch the same AI opponent. */
  aiRematchCooldownMs: number;
  /** WS ping interval (ms). */
  wsPingIntervalMs: number;
  /** Full URL of the internal stats processor endpoint — `null` when not configured. */
  statsProcessorUrl: string | null;
  /** Shared secret used to authenticate gateway → stats processor requests. */
  statsProcessorSecret: string | null;

  // ---------------------------------------------------------------------------
  // Local exclusive locks (serialise concurrent operations per connection)
  // ---------------------------------------------------------------------------

  /** Exclusive lock serialising ranked queue enqueue/dequeue. */
  localQueueLock: LocalLock;
  /** Exclusive lock serialising MATCH_JOIN operations. */
  matchJoinLock: LocalLock;

  // ---------------------------------------------------------------------------
  // Callbacks for closures that capture timer handles or other main()-local state
  // ---------------------------------------------------------------------------

  /** Flush all pending input-update batches to the DB. */
  flushPendingInputUpdates: (reason: "timer" | "threshold" | "shutdown") => Promise<void>;
  /** Start or reset the no-show timer for a ranked match. */
  scheduleNoShowTimeout: (matchId: string) => void;
  /** Cancel the no-show timer for a match. */
  clearNoShowTimer: (matchId: string) => void;
  /** Cancel the disconnect-forfeit timer for a specific user+match. */
  clearDisconnectForfeitTimer: (matchId: string, userId: string) => void;
  /** Set or reset the disconnect-forfeit timer for a user+match. */
  scheduleDisconnectForfeit: (matchId: string, userId: string, delayMs?: number) => void;
  /** Attempt to start the ranked countdown, returns `true` if started. */
  maybeStartRankedCountdown: (match: LocalMatch) => Promise<boolean>;
  /** Restore or reset the authoritative countdown activation timer for a local match. */
  scheduleCountdownActivation: (match: LocalMatch) => void;
  /** Load (or return cached) user profile for a connected socket. */
  loadConnectionUser: (userId: string) => Promise<ConnectionUser>;
  /** Create a new ranked 1v1 match and broadcast MATCH_FOUND. */
  createRanked1v1Match: (params: {
    users: Array<ConnectionUser & { slot: number }>;
    persistUserIds: string[];
    startDelayMs?: number;
    /** Set `true` for bot-fallback matches to apply halved ELO change. */
    isLowConfidence?: boolean;
  }) => Promise<{ matchId: string; local: LocalMatch; serverStartAtMs: number; payload: unknown }>;
  /** Create a new room match and broadcast MATCH_FOUND to the room. */
  startRoomMatch: (params: {
    roomId: string;
    roomCode: string;
    members: Array<{
      userId: string;
      colorSlot: number;
      readyAt: Date | null;
      leftAt: Date | null;
      user: { username: string | null; profile: { avatar: string | null } | null };
    }>;
    startDelayMs?: number;
  }) => Promise<{ matchId: string; local: LocalMatch; serverStartAtMs: number } | null>;
  /** Record that a MATCH_JOIN flow has begun (prevents premature forfeit). */
  beginMatchJoinInFlight: (matchId: string, userId: string) => void;
  /** Record that a MATCH_JOIN flow has completed. */
  endMatchJoinInFlight: (matchId: string, userId: string) => void;
  /** Returns `true` if a MATCH_JOIN is currently in-flight for this user+match. */
  isMatchJoinInFlight: (matchId: string, userId: string) => boolean;
  /** Register this socket as the authoritative session for user+match. */
  claimMatchSession: (matchId: string, userId: string, ws: WsConn) => void;
  /** Release the match-session claim held by this socket. */
  releaseMatchSession: (ws: WsConn) => void;
  /** Move this socket from one room subscription to another. */
  updateSocketRoomSubscription: (ws: WsConn, nextRoomCode?: string) => void;
  /** Mark a user as online (write Redis presence key). */
  markOnline: (userId: string) => Promise<void>;
  /** Create a human-vs-human rematch with a distributed lock guard. */
  createLockedHumanRematch: (params: {
    sourceMatchId: string;
    users: Array<ConnectionUser & { slot: number }>;
    persistUserIds: string[];
  }) => Promise<boolean>;
  /** Appends a pending input-update event to the match's batch buffer. */
  enqueueInputUpdateBatch: (matchId: string, userId: string, seq: number) => void;
  /** Unified ranked-matchmaking queue adapter (Redis or local no-op). */
  queueAdapter: IQueueAdapter;
  /** Persist a reconnect-grace-window timestamp to the DB live-state for a match. */
  persistReconnectGraceWindow: (matchId: string, userId: string, reconnectUntilMs: number) => Promise<void>;
  /**
   * Activate a countdown match if its `serverStartAtMs` has passed.
   * Returns `true` if the transition to `live` was applied, `false` otherwise.
   * Used by the `MATCH_SYNC_REQUEST` handler as a client-triggered catch-up.
   */
  activateCountdownMatchIfDue: (matchId: string) => Promise<boolean>;
}
