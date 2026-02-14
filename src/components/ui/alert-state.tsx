"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { AlertTriangle, CheckCircle2, X as CloseIcon, XCircle } from "lucide-react";
import { useAlert } from "@/contexts/alert-context";
import ClientOnly from "./ClientOnly";

export const AlertState = () => {
  const { alerts, clearAlert } = useAlert();

  return (
    <ClientOnly>
      <div
        className="fixed z-[99999] top-4 left-1/2 -translate-x-1/2 !transform"
        aria-live="polite"
        aria-relevant="additions removals"
      >
        <AnimatePresence mode="popLayout">
          {alerts.map((alert) => {
            const Icon =
              alert.type === "success"
                ? CheckCircle2
                : alert.type === "warning"
                  ? AlertTriangle
                  : XCircle;

            return (
              <motion.div
                key={alert.id}
                layout
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{
                  y: { type: "spring", stiffness: 150, damping: 28, mass: 0.9 },
                  opacity: { duration: 0.2, ease: "easeOut" },
                  scale: { duration: 0.2, ease: "easeOut" },
                }}
                className={clsx(
                  "mb-2 text-sm px-4 py-3 rounded-md border w-[min(90vw,400px)]",
                  "min-w-[220px] text-left leading-[1.6]",
                  {
                    "bg-green-900/90 text-green-100 border-green-600":
                      alert.type === "success",
                    "bg-orange-900/90 text-orange-100 border-orange-500":
                      alert.type === "warning",
                    "bg-red-900/90 text-red-100 border-red-600":
                      alert.type === "error",
                  }
                )}
                role="alert"
              >
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-current" aria-hidden="true" />

                  <div className="flex-1 break-words">{alert.message}</div>

                  <button
                    type="button"
                    onClick={() => clearAlert(alert.id)}
                    className="-mr-1 -mt-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-current opacity-80 transition-opacity hover:opacity-100"
                    aria-label="Dismiss alert"
                  >
                    <CloseIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ClientOnly>
  );
};