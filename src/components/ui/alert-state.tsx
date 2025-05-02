"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { useAlert } from "@/contexts/alert-context";

export const AlertState = () => {
  const { alert } = useAlert();

  return (
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
            "min-w-[200px] text-center leading-[1.6]", // إضافة خصائص للمسافات
            {
              "text-green-400 bg-green-500/10 border-green-400/20": alert.type === "success",
              "text-red-400 bg-red-500/10 border-red-400/20": alert.type === "error",
            }
          )}
          style={{ transform: 'translateZ(0)' }} // إضافة سياق مكدس جديد

        >
          <span role="alert" className="block px-[0.5em]">
            {alert.message}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};