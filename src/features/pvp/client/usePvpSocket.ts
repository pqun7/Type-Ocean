"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "./types";

type Status = "idle" | "connecting" | "ready" | "error";

export function usePvpSocket() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ userId: string; username: string; avatar: string | null } | null>(null);
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Array<(m: ServerMessage) => void>>([]);

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

      const res = await fetch("/api/pvp/ws-token", { method: "GET" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to get token");
      }

      const body = (await res.json()) as { token: string; expiresAt: string; wsUrl: string | null };
      if (!body.wsUrl) throw new Error("Missing NEXT_PUBLIC_PVP_WS_URL");

      const ws = new WebSocket(body.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "HELLO", payload: { token: body.token } } satisfies ClientMessage));
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
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({ status, error, user, lastMessage, send, addListener }),
    [status, error, user, lastMessage, send, addListener]
  );
}
