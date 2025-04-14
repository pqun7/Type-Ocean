import { useLevel } from "@/contexts/hook/useLevel";
import { useDailyChallenge } from "@/hooks/useDailyChallenge";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IoCheckmarkCircle } from "react-icons/io5";
import { IoCheckmarkOutline } from "react-icons/io5";

export const DailyChallenge = () => {
  const { level } = useLevel();
  const dailyChallenge = useDailyChallenge(level);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const lastCompleted = localStorage.getItem("dailyChallengeCompleted");
    setIsCompleted(lastCompleted === today);
  }, []);

  return (
    <motion.div
      className="relative flex items-center gap-2"
      
    >
      <motion.div
        layout
        className={`flex items-center justify-start cursor-pointer
        ${
          isCompleted
            ? "bg-blue-500/90 border-blue-400"
            : "bg-slate-800/70 border-blue-500/30"
        }
        border-2 rounded-full 
        overflow-hidden`}
        initial={{ width: 40 }}
        animate={{
          width: isHovered ? 200 : 40,
          transition: { type: "spring", stiffness: 200, damping: 30 },
        }}
        style={{ height: 40 }}
        onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      >
        {/* حاوية الأيقونة مع توسيط كامل */}
        <motion.div
          className="w-[40px] h-full flex items-center justify-center absolute right-0"
          whileHover={!isCompleted || isHovered ? { scale: 1.05 } : {}}
        >
          {isCompleted ? (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="text-white text-lg font-bold"
              transition={{ type: "spring", bounce: 0.5 }}
            >
              ✓
            </motion.span>
          ) : (
            <>
              {/* Pulse animation background */}
              <motion.span
                className="absolute inset-0 bg-blue-500/20 rounded-full"
                animate={{
                  scale: !isCompleted && !isHovered ? [1, 1.2, 1] : 1,
                  opacity: !isCompleted && !isHovered ? [0.4, 0.8, 0.4] : 0,
                }}
                transition={{
                  duration: 1.5,
                  repeat: !isCompleted && !isHovered ? Infinity : 0,
                }}
              />
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-blue-400 relative z-10"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
              </svg>
            </>
          )}
        </motion.div>

        {/* Challenge text animation */}
        {dailyChallenge && (
          <motion.div
            initial={{ opacity: 1, x: 20 }}
            animate={{
              x: isHovered ? 0 : 20,

              transition: {
                type: "spring",
                stiffness: 200,
                damping: 30,
                delay: 0.1,
              },
            }}
            transition={{
              type: "tween",
              duration: 0.3,
              ease: "easeOut",
            }}
            className="pr-14 pl-5 whitespace-nowrap text-sm font-medium w-full text-right"
            style={{ color: isCompleted ? "#fff" : "#93c5fd" }}
          >
            {dailyChallenge.type === "wpm" && `${dailyChallenge.target} WPM`}
            {dailyChallenge.type === "accuracy" &&
              `${dailyChallenge.target}% accuracy`}
            {dailyChallenge.type === "length" &&
              `${dailyChallenge.target} characters`}
          </motion.div>
        )}
      </motion.div>
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 1, scale: 0.95, x: -50 }}
            animate={{ opacity: 1, y: 0, scale: 1, x: -67 }}
            exit={{ opacity: 0, y: 1, scale: 0.95, x: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 px-4 py-1.5 bg-slate-800 text-xs text-white rounded-md shadow-lg border border-slate-700 font-medium min-w-[120px] text-center whitespace-nowrap z-50"
          >
            {/* السهم */}
            <div className="absolute -top-[6px] left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800 border-l border-t border-slate-700 rotate-45 transform" />
            Daily Challenge
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
