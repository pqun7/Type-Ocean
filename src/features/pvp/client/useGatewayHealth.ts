"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GatewayHealthStatus = "unknown" | "up" | "down";

const POLL_INTERVAL_MS = 8_000;
const INITIAL_POLL_DELAY_MS = 0;

/**
 * Polls `/api/pvp/gateway-health` on mount and every `POLL_INTERVAL_MS`.
 *
 * Returns `"unknown"` before the first response, `"up"` when the gateway is
 * reachable, and `"down"` when it is not or an error occurs.
 */
export function useGatewayHealth(): GatewayHealthStatus {
  const [status, setStatus] = useState<GatewayHealthStatus>("unknown");
  const mounted = useRef(true);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/pvp/gateway-health", { cache: "no-store" });
      if (!mounted.current) return;
      if (!res.ok) {
        setStatus("down");
        return;
      }
      const body = (await res.json()) as { ok: boolean };
      if (!mounted.current) return;
      setStatus(body.ok ? "up" : "down");
    } catch {
      if (mounted.current) setStatus("down");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const timeoutId = setTimeout(() => {
      void check();
    }, INITIAL_POLL_DELAY_MS);

    const intervalId = setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      mounted.current = false;
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [check]);

  return status;
}
