"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ClientMessage, ServerMessage } from "./types";
import { logger } from "@/log/clientLogger";
import { PVP_ERROR_CODES, type PvpErrorPayload } from "@/features/pvp/shared/error-codes";
import { toSafePvpErrorMessage } from "./pvp-error-utils";
import {
  type ConnectionState,
  CIRCUIT_BREAKER_COOLDOWN_MS,
  idleState,
  onDisconnect,
  onReconnectAttemptFailed,
  onHelloOk as smOnHelloOk,
} from "./connection-state-machine";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Coarse connection status, kept for backwards compatibility with
 * PvpMatchClient and PvpRoomLobbyClient which consume `status`.
 * For fine-grained reconnection tracking, use `connectionPhase`.
 */
type Status = "idle" | "connecting" | "ready" | "error";

const CLIENT_SECRET_STORAGE_KEY = "pvp:client-secret";

type WsTokenResponse = {
  token: string;
  expiresAt: number;
  refreshAfter: number;
  wsUrl: string;
};

type MatchTransportMetadata = {
  textId: string | null;
  inputNonce: string | null;
  serverStartAt: string;
};

type MatchSnapshotStatus = "PENDING" | "COUNTDOWN" | "RUNNING" | "ENDING" | "FINISHED" | "ABORTED";

type MatchSnapshotView = MatchTransportMetadata & {
  matchId: string;
  status: MatchSnapshotStatus;
  roomCode: string | null;
  revision: number;
  isCountdown: boolean;
  isActive: boolean;
  isTerminal: boolean;
};

function deriveMatchSnapshotFlags(status: MatchSnapshotStatus) {
  return {
    isCountdown: status === "COUNTDOWN",
    isActive: status === "RUNNING",
    isTerminal: status === "ENDING" || status === "FINISHED" || status === "ABORTED",
  };
}

function createMatchSnapshotView(
  snapshot:
    | Extract<ServerMessage, { type: "MATCH_FOUND" }>["payload"]
    | Extract<ServerMessage, { type: "MATCH_STATE" }>["payload"],
): MatchSnapshotView {
  const status = ("status" in snapshot ? snapshot.status : "COUNTDOWN") as MatchSnapshotStatus;
  return {
    matchId: snapshot.matchId,
    textId: snapshot.textId ?? null,
    inputNonce: snapshot.inputNonce ?? null,
    serverStartAt: snapshot.serverStartAt,
    roomCode: "roomCode" in snapshot ? snapshot.roomCode : null,
    revision: "revision" in snapshot ? snapshot.revision : 0,
    status,
    ...deriveMatchSnapshotFlags(status),
  };
}

type PvpSocketContextValue = {
  /** Coarse status for legacy consumers. Prefer `connectionPhase` for new code. */
  status: Status;
  /** Last server-sent ERROR message (cleared on successful HELLO_OK). */
  error: string | null;
  user: { userId: string; username: string; avatar: string | null; rating?: number; rankTier?: string; averageWpm?: number | null; bestWpm?: number | null; avgAcc?: number | null } | null;
  lastMessage: ServerMessage | null;
  send: (msg: ClientMessage) => boolean;
  addListener: (fn: (m: ServerMessage) => void) => () => void;
  getMatchTransport: (matchId: string) => MatchTransportMetadata | null;
  getLatestMatchSnapshot: (matchId: string) => MatchSnapshotView | null;
  /** Call once per consumer component mount; returns a cleanup fn. */
  registerConsumer: () => () => void;
  /**
   * Attempt a fresh connection from any state.
   * Safe to call from permanent_failure (manual retry) or reconnecting.
   * Blocked (no-op) while the circuit breaker is active.
   */
  reconnect: () => void;
  /**
   * Fine-grained connection phase from the state machine.
   * Use this to drive reconnect banners, button gating, and error messages.
   */
  connectionPhase: ConnectionState;
  /** True while the device has no network connection. */
  isOffline: boolean;
  /**
   * Epoch ms when the circuit breaker expires, or `null` if inactive.
   * Active after `permanent_failure` due to `max_retries_exceeded` or
   * `fatal_close_code`, blocking reconnects for CIRCUIT_BREAKER_COOLDOWN_MS.
   */
  circuitBreakerActiveUntil: number | null;
  /** Refresh auth and user card stats without reopening the websocket. */
  refreshUserSnapshot: () => Promise<boolean>;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createRequestId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function createClientSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function getClientSecret() {
  if (typeof window === "undefined") return createClientSecret();
  const existing = window.sessionStorage.getItem(CLIENT_SECRET_STORAGE_KEY);
  if (existing) return existing;

  const next = createClientSecret();
  window.sessionStorage.setItem(CLIENT_SECRET_STORAGE_KEY, next);
  return next;
}

/**
 * Map the state-machine ConnectionState to the legacy coarse Status value.
 * Consumers that only care about "is the socket ready?" should use `status`.
 * Consumers that need reconnect-phase awareness should use `connectionPhase`.
 */
function toStatus(phase: ConnectionState): Status {
  switch (phase.kind) {
    case "idle":
      return "idle";
    case "connecting":
      return "connecting";
    case "ready":
      return "ready";
    case "reconnecting":
    case "permanent_failure":
      return "error";
  }
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const PvpSocketContext = createContext<PvpSocketContextValue | null>(null);

/** Delay (ms) before closing the socket when no consumers remain. */
const SOCKET_IDLE_CLOSE_DELAY_MS = 3_000;

/** Application-level heartbeat interval in ms. */
const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Number of consecutive unanswered PINGs before the socket is force-closed
 * so the reconnect machinery can kick in.
 */
const MAX_MISSED_HEARTBEATS = 12;

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function PvpSocketProvider({ children }: { children: ReactNode }) {
  /** Fine-grained connection phase (drives banner + button gating). */
  const [connectionPhase, setConnectionPhase] = useState<ConnectionState>(idleState);
  /** Synchronous ref copy so event handlers don't capture stale closures. */

  const connectionPhaseRef = useRef<ConnectionState>(idleState());

  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ userId: string; username: string; avatar: string | null; rating?: number; rankTier?: string; averageWpm?: number | null; bestWpm?: number | null; avgAcc?: number | null } | null>(null);
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Array<(m: ServerMessage) => void>>([]);
  const refreshTimerRef = useRef<number | null>(null);
  const matchTransportRef = useRef(new Map<string, MatchTransportMetadata>());
  const latestMatchSnapshotRef = useRef(new Map<string, MatchSnapshotView>());

  /** Tracks how many consumer components are mounted. */
  const consumerCountRef = useRef(0);
  /** Timer for delayed idle close. */
  const idleCloseTimerRef = useRef<number | null>(null);
  /** Monotonically increasing version to guard stale callbacks. */
  const versionRef = useRef(0);
  /** Deduplicates concurrent ensureConnected() calls. */
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  /** Retry timer when the socket closes unexpectedly while consumers are mounted. */
  const reconnectTimerRef = useRef<number | null>(null);
  /** Tracks the current reconnect attempt number independently of connectionPhase,
   * so onclose can read the right count even when phase has transitioned to "connecting". */
  const reconnectAttemptRef = useRef(0);
  /** True while the browser is offline; suspends auto-reconnect. */
  const isOfflineRef = useRef(false);
  /** Application-level heartbeat interval handle. */
  const heartbeatIntervalRef = useRef<number | null>(null);
  /** Number of consecutive PINGs sent without a PONG response. */
  const missedHeartbeatsRef = useRef(0);

  /** React state for offline indicator (triggers re-render). */
  const [isOffline, setIsOffline] = useState(false);
  /**
   * Ref counterpart to `circuitBreakerActiveUntil` for synchronous reads
   * inside callbacks (avoids stale closures on `reconnect()`).
   */
  const circuitBreakerUntilRef = useRef<number | null>(null);
  /**
   * Epoch ms when the circuit breaker expires — exposed to consumers so they
   * can render a countdown.  Null when the circuit breaker is not active.
   */
  const [circuitBreakerActiveUntil, setCircuitBreakerActiveUntil] = useState<number | null>(null);
  /**
   * AbortController refreshed on every `teardown()`.  Pending timer callbacks
   * check `signal.aborted` to skip execution after the provider is torn down.
   */
  const abortControllerRef = useRef(new AbortController());

  /* ---------- state machine helper ---------- */

  /** Update both the React state and the synchronous ref in one call. */
  const updateConnectionPhase = useCallback((next: ConnectionState) => {
    connectionPhaseRef.current = next;
    setConnectionPhase(next);
  }, []);

  /* ---------- low-level timer helpers ---------- */

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current == null) return;
    window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
  }, []);

  const clearIdleCloseTimer = useCallback(() => {
    if (idleCloseTimerRef.current == null) return;
    window.clearTimeout(idleCloseTimerRef.current);
    idleCloseTimerRef.current = null;
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current == null) return;
    window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const setSafeError = useCallback((nextError: string | PvpErrorPayload | null | undefined) => {
    setError(toSafePvpErrorMessage(nextError));
  }, []);

  /* ---------- heartbeat ---------- */

  /**
   * Stop the application-level heartbeat and reset missed-pong counter.
   * Safe to call multiple times.
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current != null) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    missedHeartbeatsRef.current = 0;
  }, []);

  /**
   * Start the application-level heartbeat after HELLO_OK.
   * Sends a PING every HEARTBEAT_INTERVAL_MS.  If MAX_MISSED_HEARTBEATS
   * consecutive PINGs go unanswered, force-closes the socket to trigger the
   * existing reconnect machinery via onclose.
   */
  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatIntervalRef.current = window.setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        stopHeartbeat();
        return;
      }

      // Browsers heavily throttle background tabs; skipping heartbeat avoids
      // false reconnect loops when timers are delayed while hidden.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        missedHeartbeatsRef.current = 0;
        return;
      }

      // Send application-level PING (gateway replies with PONG)
      ws.send(JSON.stringify({ type: "PING" } satisfies ClientMessage));

      missedHeartbeatsRef.current += 1;

      if (missedHeartbeatsRef.current > MAX_MISSED_HEARTBEATS) {
        logger.pvp.warn("PvP heartbeat: too many consecutive missed PONGs, force-closing socket", {
          missed: missedHeartbeatsRef.current,
        });
        stopHeartbeat();
        // Force-close triggers ws.onclose → reconnect machinery
        ws.close(1001, "Heartbeat timeout");
        return;
      }

      logger.pvp.debug("PvP heartbeat: PING sent", { pendingAcks: missedHeartbeatsRef.current });
    }, HEARTBEAT_INTERVAL_MS);
  }, [stopHeartbeat]);

  /* ---------- token / auth ---------- */

  const fetchWsToken = useCallback(async () => {
    const clientSecret = getClientSecret();
    logger.pvp.debug("Requesting websocket token", { route: "/api/pvp/ws-token" });
    const res = await fetch("/api/pvp/ws-token", {
      method: "GET",
      headers: { "x-pvp-client-secret": clientSecret },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      logger.pvp.warn("Websocket token request failed", {
        status: res.status,
        error: body?.error ?? "Failed to get token",
      });
      throw new Error(body?.error ?? "Failed to get token");
    }

    const body = (await res.json()) as Omit<WsTokenResponse, "wsUrl"> & { wsUrl: string | null };
    if (!body.wsUrl) throw new Error("Missing NEXT_PUBLIC_PVP_WS_URL");
    logger.pvp.info("Websocket token acquired", {
      expiresAt: body.expiresAt,
      refreshAfter: body.refreshAfter,
    });
    return { ...body, wsUrl: body.wsUrl, clientSecret };
  }, []);

  const scheduleRefresh = useCallback(
    (refreshAfter: number) => {
      if (typeof window === "undefined") return;
      clearRefreshTimer();

      const delayMs = Math.max(5_000, refreshAfter * 1000 - Date.now());
      refreshTimerRef.current = window.setTimeout(() => {
        void (async () => {
          try {
            const nextAuth = await fetchWsToken();
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            logger.pvp.debug("Refreshing websocket authentication", {
              readyState: ws.readyState,
              refreshAfter: nextAuth.refreshAfter,
            });

            ws.send(
              JSON.stringify({
                type: "AUTH_REFRESH",
                payload: { token: nextAuth.token, clientSecret: nextAuth.clientSecret },
              } satisfies ClientMessage),
            );

            scheduleRefresh(nextAuth.refreshAfter);
          } catch (refreshError) {
            logger.pvp.error(
              "Websocket token refresh failed",
              refreshError instanceof Error ? refreshError : new Error(String(refreshError)),
            );
            setSafeError(
              refreshError instanceof Error ? refreshError.message : "Failed to refresh websocket token",
            );
          }
        })();
      }, delayMs);
    },
    [clearRefreshTimer, fetchWsToken, setSafeError],
  );

  /* ---------- connection lifecycle ---------- */

  const teardown = useCallback(() => {
    versionRef.current += 1;
    // Abort any pending timer callbacks tied to this session
    abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    clearRefreshTimer();
    clearIdleCloseTimer();
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    stopHeartbeat();
    connectPromiseRef.current = null;
    updateConnectionPhase(idleState());
    try {
      wsRef.current?.close();
    } catch {
      // ignore — socket may already be closed
    }
    wsRef.current = null;
    setError(null);
    setUser(null);
    setLastMessage(null);
    circuitBreakerUntilRef.current = null;
    setCircuitBreakerActiveUntil(null);
    isOfflineRef.current = false;
    setIsOffline(false);
  }, [clearRefreshTimer, clearIdleCloseTimer, clearReconnectTimer, stopHeartbeat, updateConnectionPhase]);

  const ensureConnected = useCallback(() => {
    // Already connected or connecting — do not open a second socket
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      return connectPromiseRef.current ?? Promise.resolve();
    }

    if (connectPromiseRef.current) return connectPromiseRef.current;

    // Circuit breaker: block reconnects while cooldown is active
    const cbUntil = circuitBreakerUntilRef.current;
    if (cbUntil !== null && Date.now() < cbUntil) {
      return Promise.resolve();
    }

    const capturedVersion = ++versionRef.current;

    /**
     * Schedule the next reconnect attempt using the delay from the state
     * machine.  Must only be called when the new state is `reconnecting`.
     */
    const scheduleReconnect = (retryAtMs: number, attempt: number) => {
      reconnectAttemptRef.current = attempt;
      if (consumerCountRef.current <= 0) return;
      if (reconnectTimerRef.current != null) return;

      if (isOfflineRef.current) {
        logger.pvp.info("Network offline – deferring PvP reconnect until online");
        return;
      }

      const signal = abortControllerRef.current.signal;
      const delayMs = Math.max(0, retryAtMs - Date.now());
      logger.pvp.info("Scheduling PvP websocket reconnect", { attempt, delayMs });

      reconnectTimerRef.current = window.setTimeout(() => {
        if (signal.aborted) return;
        reconnectTimerRef.current = null;
        void ensureConnected();
      }, delayMs);
    };

    const promise = (async () => {
      updateConnectionPhase({ kind: "connecting" });
      setError(null);
      logger.pvp.info("Initializing PvP websocket connection");

      const auth = await fetchWsToken();
      if (versionRef.current !== capturedVersion) return; // stale — another attempt superseded us

      const ws = new WebSocket(auth.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (versionRef.current !== capturedVersion) return;
        clearReconnectTimer();
        logger.pvp.info("PvP websocket connection opened", { wsUrl: auth.wsUrl });
        ws.send(
          JSON.stringify({
            type: "HELLO",
            payload: { token: auth.token, clientSecret: auth.clientSecret },
          } satisfies ClientMessage),
        );
        scheduleRefresh(auth.refreshAfter);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data)) as ServerMessage;
          if (versionRef.current !== capturedVersion) return;

          // Any inbound frame proves liveness, not just PONG.
          missedHeartbeatsRef.current = 0;

          logger.pvp.debug("Received PvP socket message", { type: msg.type });
          setLastMessage(msg);

          if (msg.type === "MATCH_FOUND") {
            const nextSnapshot = createMatchSnapshotView(msg.payload);
            matchTransportRef.current.set(msg.payload.matchId, nextSnapshot);
            latestMatchSnapshotRef.current.set(msg.payload.matchId, nextSnapshot);
          }

          if (msg.type === "MATCH_STATE") {
            const nextSnapshot = createMatchSnapshotView(msg.payload);
            matchTransportRef.current.set(msg.payload.matchId, nextSnapshot);
            latestMatchSnapshotRef.current.set(msg.payload.matchId, nextSnapshot);
          }

          if (msg.type === "HELLO_OK") {
            // Transition to ready + reset reconnect counters
            reconnectAttemptRef.current = 0;
            updateConnectionPhase(smOnHelloOk());
            setError(null);
            setUser(msg.payload.user);
            startHeartbeat(); // begin application-level heartbeat
            logger.pvp.info("PvP websocket authenticated", {
              userId: msg.payload.user.userId,
            });
          }

          if (msg.type === "PONG") {
            logger.pvp.debug("PvP heartbeat: PONG received");
          }

          if (msg.type === "AUTH_REFRESH_OK") {
            if (msg.payload.user) {
              setUser(msg.payload.user);
            }
            logger.pvp.debug("PvP websocket auth refresh acknowledged", {
              expiresAt: msg.payload.expiresAt,
            });
          }

          if (msg.type === "ERROR") {
            logger.pvp.warn("PvP websocket server returned an error", {
              error: msg.payload.message,
            });
            setSafeError(msg.payload.message);
          }

          for (const fn of listenersRef.current) fn(msg);
        } catch {
          logger.pvp.warn("Failed to parse PvP websocket message");
        }
      };

      ws.onerror = () => {
        if (versionRef.current !== capturedVersion) return;
        // onclose always fires after onerror — let onclose drive the reconnect
        // to avoid double-counting attempts.
        logger.pvp.error("PvP websocket transport error", new Error("WebSocket error"));
      };

      ws.onclose = (event: CloseEvent) => {
        if (versionRef.current !== capturedVersion) return;

        clearRefreshTimer();
        stopHeartbeat();
        connectPromiseRef.current = null;

        // Read the current attempt — prefer the phase if already reconnecting,
        // otherwise fall back to the ref which persists across phase transitions.
        const currentAttempt =
          connectionPhaseRef.current.kind === "reconnecting"
            ? connectionPhaseRef.current.attempt
            : reconnectAttemptRef.current;

        // If the device is offline, don't burn a retry attempt — the
        // handleOnline listener will kick off a fresh connection when
        // network access is restored.
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          isOfflineRef.current = true;
          setIsOffline(true);
          logger.pvp.info("PvP websocket closed while offline — reconnect deferred until online", {
            code: event.code,
          });
          return;
        }

        const nextPhase = onDisconnect(event.code, currentAttempt);
        updateConnectionPhase(nextPhase);

        logger.pvp.warn("PvP websocket connection closed", {
          code: event.code,
          reason: event.reason,
          nextPhase: nextPhase.kind,
        });

        if (nextPhase.kind === "permanent_failure") {
          // Activate the circuit breaker for server-unavailability failures so
          // the client cannot hammer the server immediately after giving up.
          if (
            nextPhase.reason === "max_retries_exceeded" ||
            nextPhase.reason === "fatal_close_code"
          ) {
            const until = nextPhase.failedAt + CIRCUIT_BREAKER_COOLDOWN_MS;
            circuitBreakerUntilRef.current = until;
            setCircuitBreakerActiveUntil(until);
          }
          logger.pvp.error(
            "PvP connection: permanent failure — no further automatic reconnect",
            new Error(nextPhase.message),
            { reason: nextPhase.reason },
          );
          // Notify other consumers (e.g. PvpMatchClient) that the connection dropped
          setSafeError({
            code: PVP_ERROR_CODES.QUEUE_CONNECTION_CLOSED,
            message: nextPhase.message,
            retryable: false,
          });
          return;
        }

        if (nextPhase.kind === "reconnecting") {
          scheduleReconnect(nextPhase.nextRetryAt, nextPhase.attempt);
        }
      };
    })().catch((e: unknown) => {
      if (versionRef.current !== capturedVersion) return;

      logger.pvp.error(
        "Failed to initialize PvP websocket",
        e instanceof Error ? e : new Error(String(e)),
      );
      connectPromiseRef.current = null;

      const currentAttempt =
        connectionPhaseRef.current.kind === "reconnecting"
          ? connectionPhaseRef.current.attempt
          : reconnectAttemptRef.current;

      const nextPhase = onReconnectAttemptFailed(currentAttempt);
      updateConnectionPhase(nextPhase);

      if (nextPhase.kind === "permanent_failure") {
        if (nextPhase.reason === "max_retries_exceeded") {
          const until = nextPhase.failedAt + CIRCUIT_BREAKER_COOLDOWN_MS;
          circuitBreakerUntilRef.current = until;
          setCircuitBreakerActiveUntil(until);
        }
        setSafeError(e instanceof Error ? e.message : "Failed to connect to match server");
        return;
      }

      if (nextPhase.kind === "reconnecting") {
        scheduleReconnect(nextPhase.nextRetryAt, nextPhase.attempt);
      }
    });

    connectPromiseRef.current = promise;
    return promise;
  }, [
    clearReconnectTimer,
    clearRefreshTimer,
    fetchWsToken,
    scheduleRefresh,
    setCircuitBreakerActiveUntil,
    setIsOffline,
    setSafeError,
    startHeartbeat,
    stopHeartbeat,
    updateConnectionPhase,
  ]);

  /* ---------- consumer registration (lazy connect / idle close) ---------- */

  const registerConsumer = useCallback(() => {
    consumerCountRef.current += 1;
    clearIdleCloseTimer();

    // Lazily open the socket when the first consumer mounts
    void ensureConnected();

    return () => {
      consumerCountRef.current -= 1;

      if (consumerCountRef.current <= 0) {
        consumerCountRef.current = 0; // guard against double-unregister
        // Delay teardown so navigating between PvP pages doesn't flicker
        const signal = abortControllerRef.current.signal;
        idleCloseTimerRef.current = window.setTimeout(() => {
          if (signal.aborted) return;
          if (consumerCountRef.current <= 0) {
            logger.pvp.info("No PvP consumers remain – closing shared socket");
            teardown();
          }
        }, SOCKET_IDLE_CLOSE_DELAY_MS);
      }
    };
  }, [clearIdleCloseTimer, ensureConnected, teardown]);

  /* ---------- cleanup on provider unmount ---------- */

  useEffect(() => {
    return () => {
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- network offline / online ---------- */

  useEffect(() => {
    const handleOffline = () => {
      isOfflineRef.current = true;
      setIsOffline(true);
      clearReconnectTimer();
      logger.pvp.info("Network offline – PvP reconnect paused");
    };

    const handleOnline = () => {
      if (!isOfflineRef.current) return;
      isOfflineRef.current = false;
      setIsOffline(false);
      logger.pvp.info("Network online – attempting PvP reconnect");
      if (consumerCountRef.current <= 0) return;
      // Coming back online is a genuine fresh start — clear the circuit breaker
      // so the reconnect isn't blocked by a previous failure cycle.
      circuitBreakerUntilRef.current = null;
      setCircuitBreakerActiveUntil(null);
      // Give a fresh start after the network comes back
      updateConnectionPhase(idleState());
      clearReconnectTimer();
      void ensureConnected();
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [clearReconnectTimer, ensureConnected, updateConnectionPhase]);

  /* ---------- public API ---------- */

  const addListener = useCallback((fn: (m: ServerMessage) => void) => {
    listenersRef.current.push(fn);
    return () => {
      listenersRef.current = listenersRef.current.filter((x) => x !== fn);
    };
  }, []);

  const getMatchTransport = useCallback((matchId: string) => {
    return matchTransportRef.current.get(matchId) ?? null;
  }, []);

  const getLatestMatchSnapshot = useCallback((matchId: string) => {
    return latestMatchSnapshotRef.current.get(matchId) ?? null;
  }, []);

  const send = useCallback(
    (msg: ClientMessage) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        void ensureConnected();
        setSafeError({
          code: PVP_ERROR_CODES.QUEUE_SOCKET_NOT_READY,
          message: "PvP socket is reconnecting",
          retryable: true,
        });
        return false;
      }

      const nextMessage = msg.requestId
        ? msg
        : ({ ...msg, requestId: createRequestId() } satisfies ClientMessage);

      logger.pvp.debug("Sending PvP socket message", {
        type: nextMessage.type,
        requestId: nextMessage.requestId,
      });
      ws.send(JSON.stringify(nextMessage));
      return true;
    },
    [ensureConnected, setSafeError],
  );

  /**
   * Attempt a fresh connection from any state.
   *
   * - From `permanent_failure`: full manual retry (resets state machine to idle).
   * - From `reconnecting`: cancels the pending timer and reconnects immediately.
   * - From `connecting`: no-op (already in progress).
   * - While circuit breaker is active: no-op (blocked until cooldown expires).
   */
  const reconnect = useCallback(() => {
    if (connectionPhaseRef.current.kind === "connecting") return;

    // Block manual retry while the circuit breaker is cooling down
    const cbUntil = circuitBreakerUntilRef.current;
    if (cbUntil !== null && Date.now() < cbUntil) {
      logger.pvp.warn("Manual reconnect blocked by circuit breaker", {
        remainingMs: cbUntil - Date.now(),
      });
      return;
    }
    // Clear an expired circuit breaker so the next automatic check is clean
    if (cbUntil !== null) {
      circuitBreakerUntilRef.current = null;
      setCircuitBreakerActiveUntil(null);
    }

    reconnectAttemptRef.current = 0;
    clearReconnectTimer();
    updateConnectionPhase(idleState());
    void ensureConnected();
  }, [clearReconnectTimer, ensureConnected, updateConnectionPhase]);

  const refreshUserSnapshot = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      await ensureConnected();
      return false;
    }

    try {
      const nextAuth = await fetchWsToken();
      ws.send(
        JSON.stringify({
          type: "AUTH_REFRESH",
          payload: { token: nextAuth.token, clientSecret: nextAuth.clientSecret },
        } satisfies ClientMessage),
      );
      scheduleRefresh(nextAuth.refreshAfter);
      return true;
    } catch (refreshError) {
      logger.pvp.error(
        "Manual PvP auth refresh failed",
        refreshError instanceof Error ? refreshError : new Error(String(refreshError)),
      );
      setSafeError(
        refreshError instanceof Error ? refreshError.message : "Failed to refresh websocket token",
      );
      return false;
    }
  }, [ensureConnected, fetchWsToken, scheduleRefresh, setSafeError]);

  // Derive the coarse `status` from the state machine (no separate state var)
  const status: Status = toStatus(connectionPhase);

  const value = useMemo<PvpSocketContextValue>(
    () => ({
      status,
      error,
      user,
      lastMessage,
      send,
      addListener,
      getMatchTransport,
      getLatestMatchSnapshot,
      registerConsumer,
      reconnect,
      connectionPhase,
      isOffline,
      circuitBreakerActiveUntil,
      refreshUserSnapshot,
    }),
    [
      status,
      error,
      user,
      lastMessage,
      send,
      addListener,
      getMatchTransport,
      getLatestMatchSnapshot,
      registerConsumer,
      reconnect,
      connectionPhase,
      isOffline,
      circuitBreakerActiveUntil,
      refreshUserSnapshot,
    ],
  );

  return <PvpSocketContext.Provider value={value}>{children}</PvpSocketContext.Provider>;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function usePvpSocket() {
  const ctx = useContext(PvpSocketContext);
  if (!ctx) {
    throw new Error("usePvpSocket must be used within a <PvpSocketProvider>");
  }

  // Register this component as an active consumer
  useEffect(() => {
    return ctx.registerConsumer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(
    () => ({
      status: ctx.status,
      error: ctx.error,
      user: ctx.user,
      lastMessage: ctx.lastMessage,
      send: ctx.send,
      addListener: ctx.addListener,
      getMatchTransport: ctx.getMatchTransport,
      getLatestMatchSnapshot: ctx.getLatestMatchSnapshot,
      reconnect: ctx.reconnect,
      connectionPhase: ctx.connectionPhase,
      isOffline: ctx.isOffline,
      circuitBreakerActiveUntil: ctx.circuitBreakerActiveUntil,
      refreshUserSnapshot: ctx.refreshUserSnapshot,
    }),
    [
      ctx.status,
      ctx.error,
      ctx.user,
      ctx.lastMessage,
      ctx.send,
      ctx.addListener,
      ctx.getMatchTransport,
      ctx.getLatestMatchSnapshot,
      ctx.reconnect,
      ctx.connectionPhase,
      ctx.isOffline,
      ctx.circuitBreakerActiveUntil,
      ctx.refreshUserSnapshot,
    ],
  );
}

