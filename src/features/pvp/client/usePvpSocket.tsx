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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

type PvpSocketContextValue = {
  status: Status;
  error: string | null;
  user: { userId: string; username: string; avatar: string | null } | null;
  lastMessage: ServerMessage | null;
  send: (msg: ClientMessage) => boolean;
  addListener: (fn: (m: ServerMessage) => void) => () => void;
  getMatchTransport: (matchId: string) => MatchTransportMetadata | null;
  /** Call once per consumer component mount; returns a cleanup fn. */
  registerConsumer: () => () => void;
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

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const PvpSocketContext = createContext<PvpSocketContextValue | null>(null);

/** Delay (ms) before closing the socket when no consumers remain. */
const SOCKET_IDLE_CLOSE_DELAY_MS = 3_000;

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function PvpSocketProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ userId: string; username: string; avatar: string | null } | null>(null);
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Array<(m: ServerMessage) => void>>([]);
  const refreshTimerRef = useRef<number | null>(null);
  const matchTransportRef = useRef(new Map<string, MatchTransportMetadata>());

  /** Tracks how many consumer components are mounted. */
  const consumerCountRef = useRef(0);
  /** Timer for delayed idle close. */
  const idleCloseTimerRef = useRef<number | null>(null);
  /** Monotonically increasing version to guard stale callbacks. */
  const versionRef = useRef(0);
  /** Deduplicates concurrent ensureConnected() calls. */
  const connectPromiseRef = useRef<Promise<void> | null>(null);

  /* ---------- low-level helpers ---------- */

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

  const setSafeError = useCallback((nextError: string | PvpErrorPayload | null | undefined) => {
    setError(toSafePvpErrorMessage(nextError));
  }, []);

  const fetchWsToken = useCallback(async () => {
    const clientSecret = getClientSecret();
    logger.pvp.debug("Requesting websocket token", { route: "/api/pvp/ws-token" });
    const res = await fetch("/api/pvp/ws-token", {
      method: "GET",
      headers: {
        "x-pvp-client-secret": clientSecret,
      },
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
                payload: {
                  token: nextAuth.token,
                  clientSecret: nextAuth.clientSecret,
                },
              } satisfies ClientMessage)
            );

            scheduleRefresh(nextAuth.refreshAfter);
          } catch (refreshError) {
            setStatus("error");
            logger.pvp.error(
              "Websocket token refresh failed",
              refreshError instanceof Error ? refreshError : new Error(String(refreshError))
            );
            setSafeError(refreshError instanceof Error ? refreshError.message : "Failed to refresh websocket token");
          }
        })();
      }, delayMs);
    },
    [clearRefreshTimer, fetchWsToken, setSafeError]
  );

  /* ---------- connection lifecycle ---------- */

  const teardown = useCallback(() => {
    versionRef.current += 1;
    clearRefreshTimer();
    clearIdleCloseTimer();
    connectPromiseRef.current = null;
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    wsRef.current = null;
    setStatus("idle");
    setError(null);
    setUser(null);
    setLastMessage(null);
  }, [clearRefreshTimer, clearIdleCloseTimer]);

  const ensureConnected = useCallback(() => {
    // Already connected or connecting
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      return connectPromiseRef.current ?? Promise.resolve();
    }

    if (connectPromiseRef.current) return connectPromiseRef.current;

    const capturedVersion = ++versionRef.current;

    const promise = (async () => {
      setStatus("connecting");
      setError(null);
      logger.pvp.info("Initializing PvP websocket connection");

      const auth = await fetchWsToken();
      if (versionRef.current !== capturedVersion) return; // stale

      const ws = new WebSocket(auth.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (versionRef.current !== capturedVersion) return;
        logger.pvp.info("PvP websocket connection opened", { wsUrl: auth.wsUrl });
        ws.send(
          JSON.stringify({
            type: "HELLO",
            payload: { token: auth.token, clientSecret: auth.clientSecret },
          } satisfies ClientMessage)
        );
        scheduleRefresh(auth.refreshAfter);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data)) as ServerMessage;
          if (versionRef.current !== capturedVersion) return;
          logger.pvp.debug("Received PvP socket message", { type: msg.type });
          setLastMessage(msg);
          if (msg.type === "MATCH_FOUND") {
            matchTransportRef.current.set(msg.payload.matchId, {
              textId: msg.payload.textId ?? null,
              inputNonce: msg.payload.inputNonce ?? null,
              serverStartAt: msg.payload.serverStartAt,
            });
          }
          if (msg.type === "MATCH_STATE") {
            matchTransportRef.current.set(msg.payload.matchId, {
              textId: msg.payload.textId ?? null,
              inputNonce: msg.payload.inputNonce ?? null,
              serverStartAt: msg.payload.serverStartAt,
            });
          }
          if (msg.type === "HELLO_OK") {
            setUser(msg.payload.user);
            setStatus("ready");
            logger.pvp.info("PvP websocket authenticated", { userId: msg.payload.user.userId });
          }
          if (msg.type === "AUTH_REFRESH_OK") {
            setStatus("ready");
            logger.pvp.debug("PvP websocket auth refresh acknowledged", { expiresAt: msg.payload.expiresAt });
          }
          if (msg.type === "ERROR") {
            logger.pvp.warn("PvP websocket server returned an error", { error: msg.payload.message });
            setSafeError(msg.payload.message);
          }
          for (const fn of listenersRef.current) fn(msg);
        } catch {
          logger.pvp.warn("Failed to parse PvP websocket message");
        }
      };

      ws.onerror = () => {
        if (versionRef.current !== capturedVersion) return;
        setStatus("error");
        logger.pvp.error("PvP websocket transport error", new Error("WebSocket error"));
        setSafeError({
          code: PVP_ERROR_CODES.QUEUE_CONNECTION_CLOSED,
          message: "WebSocket error",
          retryable: true,
        });
      };

      ws.onclose = () => {
        if (versionRef.current !== capturedVersion) return;
        clearRefreshTimer();
        connectPromiseRef.current = null;
        setStatus((s) => (s === "ready" ? "error" : s));
        logger.pvp.warn("PvP websocket connection closed");
        setSafeError({
          code: PVP_ERROR_CODES.QUEUE_CONNECTION_CLOSED,
          message: "The PvP connection was closed",
          retryable: true,
        });
      };
    })().catch((e) => {
      if (versionRef.current !== capturedVersion) return;
      setStatus("error");
      logger.pvp.error("Failed to initialize PvP websocket", e instanceof Error ? e : new Error(String(e)));
      setSafeError(e instanceof Error ? e.message : "Unknown error");
    });

    connectPromiseRef.current = promise;
    return promise;
  }, [clearRefreshTimer, fetchWsToken, scheduleRefresh, setSafeError]);

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
        idleCloseTimerRef.current = window.setTimeout(() => {
          if (consumerCountRef.current <= 0) {
            logger.pvp.info("No PvP consumers remain – closing shared socket");
            teardown();
          }
        }, SOCKET_IDLE_CLOSE_DELAY_MS);
      }
    };
  }, [clearIdleCloseTimer, ensureConnected, teardown]);

  /* ---------- cleanup on unmount (provider removed entirely) ---------- */

  useEffect(() => {
    return () => {
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;

    const nextMessage = msg.requestId
      ? msg
      : ({
          ...msg,
          requestId: createRequestId(),
        } satisfies ClientMessage);

    logger.pvp.debug("Sending PvP socket message", {
      type: nextMessage.type,
      requestId: nextMessage.requestId,
    });
    ws.send(JSON.stringify(nextMessage));
    return true;
  }, []);

  const value = useMemo<PvpSocketContextValue>(
    () => ({ status, error, user, lastMessage, send, addListener, getMatchTransport, registerConsumer }),
    [status, error, user, lastMessage, send, addListener, getMatchTransport, registerConsumer]
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
    }),
    [ctx.status, ctx.error, ctx.user, ctx.lastMessage, ctx.send, ctx.addListener, ctx.getMatchTransport]
  );
}

