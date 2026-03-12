"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "./types";
import { logger } from "@/log/clientLogger";
import { toSafePvpErrorMessage } from "./pvp-error-utils";

type Status = "idle" | "connecting" | "ready" | "error";

const CLIENT_SECRET_STORAGE_KEY = "pvp:client-secret";

type WsTokenResponse = {
  token: string;
  expiresAt: number;
  refreshAfter: number;
  wsUrl: string;
};

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

export function usePvpSocket() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ userId: string; username: string; avatar: string | null } | null>(null);
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Array<(m: ServerMessage) => void>>([]);
  const refreshTimerRef = useRef<number | null>(null);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current == null) return;
    window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
  }, []);

  const setSafeError = useCallback((nextError: string | null | undefined) => {
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

  const addListener = useCallback((fn: (m: ServerMessage) => void) => {
    listenersRef.current.push(fn);
    return () => {
      listenersRef.current = listenersRef.current.filter((x) => x !== fn);
    };
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

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      setStatus("connecting");
      setError(null);
      logger.pvp.info("Initializing PvP websocket connection");

      const auth = await fetchWsToken();
      const ws = new WebSocket(auth.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
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
          if (cancelled) return;
          logger.pvp.debug("Received PvP socket message", { type: msg.type });
          setLastMessage(msg);
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
          // ignore
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setStatus("error");
        logger.pvp.error("PvP websocket transport error", new Error("WebSocket error"));
        setSafeError("WebSocket error");
      };

      ws.onclose = () => {
        if (cancelled) return;
        clearRefreshTimer();
        setStatus((s) => (s === "ready" ? "error" : s));
        logger.pvp.warn("PvP websocket connection closed");
        setSafeError("The PvP connection was closed");
      };
    }

    void connect().catch((e) => {
      if (cancelled) return;
      setStatus("error");
      logger.pvp.error("Failed to initialize PvP websocket", e instanceof Error ? e : new Error(String(e)));
      setSafeError(e instanceof Error ? e.message : "Unknown error");
    });

    return () => {
      cancelled = true;
      clearRefreshTimer();
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [clearRefreshTimer, fetchWsToken, scheduleRefresh, setSafeError]);

  return useMemo(
    () => ({ status, error, user, lastMessage, send, addListener }),
    [status, error, user, lastMessage, send, addListener]
  );
}
