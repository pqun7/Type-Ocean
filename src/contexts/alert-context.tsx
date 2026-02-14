// src/contexts/alert-context.tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type AlertType = "success" | "error" | "warning";
export type AlertItem = { id: string; message: string; type: AlertType };
type AlertValue = AlertItem | null;

function createAlertId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const AlertContext = createContext<{
  alert: AlertValue;
  alerts: AlertItem[];
  showAlert: (message: string, type: AlertType, options?: { durationMs?: number }) => void;
  clearAlert: (id?: string) => void;
}>({
  alert: null,
  alerts: [],
  showAlert: () => {},
  clearAlert: () => {},
  
});

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const timeout of timeouts.values()) clearTimeout(timeout);
      timeouts.clear();
    };
  }, []);

  const showAlert = useCallback(
    (message: string, type: AlertType, options?: { durationMs?: number }) => {
      const id = createAlertId();
      const durationMs = Math.max(0, Math.floor(options?.durationMs ?? 4500));
      const nextAlert: AlertItem = { id, message, type };

      setAlerts((prev) => {
        const next = [nextAlert, ...prev];
        const MAX_ALERTS = 4;
        if (next.length <= MAX_ALERTS) return next;

        for (const removed of next.slice(MAX_ALERTS)) {
          const t = timeoutsRef.current.get(removed.id);
          if (t) clearTimeout(t);
          timeoutsRef.current.delete(removed.id);
        }

        return next.slice(0, MAX_ALERTS);
      });

      const timeout = setTimeout(() => {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
        timeoutsRef.current.delete(id);
      }, durationMs);

      timeoutsRef.current.set(id, timeout);
    },
    []
  );

  const clearAlert = useCallback((id?: string) => {
    if (!id) {
      for (const timeout of timeoutsRef.current.values()) clearTimeout(timeout);
      timeoutsRef.current.clear();
      setAlerts([]);
      return;
    }

    const timeout = timeoutsRef.current.get(id);
    if (timeout) clearTimeout(timeout);
    timeoutsRef.current.delete(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return (
    <AlertContext.Provider value={{ alert: alerts[0] ?? null, alerts, showAlert, clearAlert }}>
      {children}
    </AlertContext.Provider>
  );
}

export const useAlert = () => useContext(AlertContext);