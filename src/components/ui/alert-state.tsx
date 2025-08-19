"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { useAlert } from "@/contexts/alert-context";
import ClientOnly from "./ClientOnly";

export const AlertState = () => {
  const { alert } = useAlert();

  return (
    <ClientOnly>
      <AnimatePresence>
        {alert && (
          <motion.div
            initial={{ opacity: 0, y: -100 }}
            animate={{ opacity: 1, y: 20 }}
            exit={{ opacity: 0, y: -100 }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
            className={clsx(
              "fixed z-[99999] top-4 left-1/2 -translate-x-1/2 !transform",
              "text-sm p-[1em] rounded-md border w-max max-w-[min(90vw,400px)]",
              "min-w-[200px] text-center leading-[1.6]",
              {
                "bg-green-900/90 text-green-100 border-green-600":
                  alert.type === "success",
                "bg-red-900/90 text-red-100 border-red-600":
                  alert.type === "error",
              }
            )}
          >
            {alert.message}
          </motion.div>
        )}
      </AnimatePresence>
    </ClientOnly>
  );
};