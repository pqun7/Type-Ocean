"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "./types";

type Status = "idle" | "connecting" | "ready" | "error";

const CLIENT_SECRET_STORAGE_KEY = "pvp:client-secret";

type WsTokenResponse = {
  token: string;
  expiresAt: number;
  refreshAfter: number;
  wsUrl: string | null;
};

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

  const fetchWsToken = useCallback(async () => {
    const clientSecret = getClientSecret();
    const res = await fetch("/api/pvp/ws-token", {
      method: "GET",
      headers: {
        "x-pvp-client-secret": clientSecret,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? "Failed to get token");
    }

    const body = (await res.json()) as WsTokenResponse;
    if (!body.wsUrl) throw new Error("Missing NEXT_PUBLIC_PVP_WS_URL");
    return { ...body, clientSecret };
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
            setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh websocket token");
          }
        })();
      }, delayMs);
    },
    [clearRefreshTimer, fetchWsToken]
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
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      setStatus("connecting");
      setError(null);

      const auth = await fetchWsToken();
      const ws = new WebSocket(auth.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
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
          setLastMessage(msg);
          if (msg.type === "HELLO_OK") {
            setUser(msg.payload.user);
            setStatus("ready");
          }
          if (msg.type === "AUTH_REFRESH_OK") {
            setStatus("ready");
          }
          if (msg.type === "ERROR") {
            setError(msg.payload.message);
          }
          for (const fn of listenersRef.current) fn(msg);
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setStatus("error");
        setError("WebSocket error");
      };

      ws.onclose = () => {
        if (cancelled) return;
        clearRefreshTimer();
        setStatus((s) => (s === "ready" ? "error" : s));
      };
    }

    void connect().catch((e) => {
      if (cancelled) return;
      setStatus("error");
      setError(e instanceof Error ? e.message : "Unknown error");
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
  }, [clearRefreshTimer, fetchWsToken, scheduleRefresh]);

  return useMemo(
    () => ({ status, error, user, lastMessage, send, addListener }),
    [status, error, user, lastMessage, send, addListener]
  );
}
