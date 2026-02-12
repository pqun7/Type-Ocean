import { useLevel } from "@/features/level/hooks/useLevel";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IoCheckmarkCircle } from "react-icons/io5";

export const DailyChallenge = ({ className }: { className?: string }) => {
  const { dailyChallenge } = useLevel();
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);

  const challengeId = dailyChallenge?.id;
  const challengeDate = dailyChallenge?.date;
  const challengeStatus = dailyChallenge?.status;

  // Reset UI when a new challenge arrives (e.g. next day) so it doesn't stay hidden.
  useEffect(() => {
    if (!challengeId || !challengeDate) return;

    setIsVisible(true);
    setIsHovered(false);
  }, [challengeId, challengeDate]);

  useEffect(() => {
    if (challengeStatus === 1) {
      setShowSuccess(true);
      const exitTimer = setTimeout(() => {
        setIsVisible(false);
      }, 1400); // allow smooth blue→green + check animation

      return () => {
        clearTimeout(exitTimer);
      };
    }
  }, [challengeStatus]);

  const clampPct = (n: number) => Math.max(0, Math.min(100, n));

  const challengeDescription = useMemo(() => {
    if (!dailyChallenge) return "";

    switch (dailyChallenge.type) {
      case "speedCombo": {
        if (
          typeof dailyChallenge.target === "object" &&
          dailyChallenge.target &&
          "wpm" in dailyChallenge.target &&
          "accuracy" in dailyChallenge.target
        ) {
          return `${dailyChallenge.target.wpm} WPM & ${dailyChallenge.target.accuracy}%`;
        }
        return "";
      }
      case "marathon":
        return `${Math.max(
          0,
          Number(dailyChallenge.target) - (dailyChallenge.data?.charactersTyped ?? 0)
        )} chars left`;
      case "timeAttack": {
        const currentSeconds = dailyChallenge.data?.timeSpent || 0;
        const targetSeconds = Number(dailyChallenge.target) || 0;
        const remainingSeconds = Math.max(0, targetSeconds - currentSeconds);
        const remainingMinutes = Math.ceil(remainingSeconds / 60);
        return `${remainingMinutes} min left`;
      }
      default:
        return "";
    }
  }, [dailyChallenge]);

  const progressData = useMemo(() => {
    if (!dailyChallenge) return null;

    const completed = dailyChallenge.status === 1;

    switch (dailyChallenge.type) {
      case "marathon": {
        const currentChars = dailyChallenge.data?.charactersTyped || 0;
        const targetChars = Number(dailyChallenge.target) || 0;
        return {
          kind: "single" as const,
          current: currentChars,
          target: targetChars,
          label: "chars",
          progress: completed
            ? 100
            : clampPct((currentChars / Math.max(1, targetChars)) * 100),
        };
      }
      case "timeAttack": {
        const currentSeconds = dailyChallenge.data?.timeSpent || 0;
        const targetSeconds = Number(dailyChallenge.target) || 0;
        return {
          kind: "single" as const,
          current: Math.floor(currentSeconds / 60),
          target: Math.ceil(targetSeconds / 60),
          label: "minutes",
          progress: completed
            ? 100
            : clampPct((currentSeconds / Math.max(1, targetSeconds)) * 100),
        };
      }
      case "speedCombo": {
        if (
          typeof dailyChallenge.target === "object" &&
          dailyChallenge.target &&
          "wpm" in dailyChallenge.target &&
          "accuracy" in dailyChallenge.target
        ) {
          const targetWpm = Number(dailyChallenge.target.wpm) || 0;
          const targetAcc = Number(dailyChallenge.target.accuracy) || 0;

          const bestWpm =
            typeof dailyChallenge.data?.bestWpm === "number"
              ? dailyChallenge.data.bestWpm
              : typeof dailyChallenge.progress?.wpm === "number"
                ? dailyChallenge.progress.wpm
                : 0;

          const bestAcc =
            typeof dailyChallenge.data?.bestAccuracy === "number"
              ? dailyChallenge.data.bestAccuracy
              : typeof dailyChallenge.progress?.accuracy === "number"
                ? dailyChallenge.progress.accuracy
                : 0;

          const wpmPct = clampPct((bestWpm / Math.max(1, targetWpm)) * 100);
          const accPct = clampPct((bestAcc / Math.max(1, targetAcc)) * 100);
          const overall = completed ? 100 : Math.min(wpmPct, accPct);

          return {
            kind: "combo" as const,
            overall,
            wpm: {
              current: Math.round(bestWpm),
              target: targetWpm,
              progress: wpmPct,
            },
            acc: {
              current: Math.round(bestAcc),
              target: targetAcc,
              progress: accPct,
            },
          };
        }
        return null;
      }
      default:
        return null;
    }
  }, [dailyChallenge]);

  // Don't render anything until we have a real challenge.
  // This avoids showing a placeholder icon during hydration/loading.
  if (!dailyChallenge) return null;

  return (
    <AnimatePresence>
    {isVisible && (
      <motion.div
        className={className ?? ""}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{
          opacity: 0,
          scale: 0, // تغيير من 0.5 إلى 0 للتصغير الكامل
          transition: { duration: 0.4 } // إزالة التأخير وتعديل المدة
        }}
      >
        <motion.div
          className="flex items-center justify-start cursor-pointer border-2 rounded-full overflow-hidden"
          initial={{ width: 30 }}
          animate={{
            width: showSuccess ? 30 : isHovered ? 150 : 30,
            backgroundColor: showSuccess ? "rgba(16,185,129,0.9)" : "rgba(37,99,235,0.18)",
            borderColor: showSuccess ? "rgba(16,185,129,0.55)" : "rgba(96,165,250,0.3)",
            transition: { type: "spring", stiffness: 200, damping: 30 },
          }}
          style={{
            height: 30,
          }}
          onHoverStart={() => !showSuccess && setIsHovered(true)}
          onHoverEnd={() => !showSuccess && setIsHovered(false)}
        >
          <motion.div className="w-[30px] h-full flex items-center justify-center absolute right-0">
            {showSuccess ? (
              <motion.svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-emerald-100"
                initial={{ rotate: -45, scale: 0 }}
                animate={{ 
                  rotate: 0, 
                  scale: 1,
                  transition: { 
                    type: "spring",
                    stiffness: 500,
                    damping: 20,
                    delay: 0.1 
                  } 
                }}
                exit={{ scale: 0 }}
              >
                <motion.path
                  d="M6 12L10.5 16.5L18 7.5"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  strokeLinecap="round"
                />
              </motion.svg>
            ) : (
                <>
                  <motion.span
                    className="absolute inset-0 bg-blue-500/20 rounded-full"
                    animate={{
                      scale:
                        dailyChallenge.status === 0 && !isHovered
                          ? [1, 1.2, 1]
                          : 1,
                      opacity:
                        dailyChallenge.status === 0 && !isHovered
                          ? [0.4, 0.8, 0.4]
                          : 0,
                    }}
                    transition={{
                      duration: 1.5,
                      repeat:
                        dailyChallenge.status === 0 && !isHovered
                          ? Infinity
                          : 0,
                    }}
                  />
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5 text-blue-400 relative z-10"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
                  </svg>
                </>
              )}
            </motion.div>

            <motion.div
              className={`pr-10 pl-7 whitespace-nowrap text-xs font-medium w-full
              ${isHovered ? "text-left" : "text-right"}
              ${dailyChallenge.status === 1 ? "text-white" : "text-blue-300"}`}
            >
              {challengeDescription}
            </motion.div>
          </motion.div>

          <AnimatePresence>
            {isHovered && (
              <motion.div
                initial={{ opacity: 0, y: 1, scale: 0.95, x: -50 }}
                animate={{ opacity: 1, y: 0, scale: 1, x: -67 }}
                exit={{ opacity: 0, y: 1, scale: 0.95, x: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full mt-2 left-1/4 transform -translate-x-1/2 px-3 py-2 bg-slate-800 text-xs text-slate-300 rounded-md shadow-lg border border-slate-700 min-w-[220px] z-50"
              >
                <div className="absolute -top-[7px] left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800 border-t border-l border-slate-700 rotate-45 transform" />

                <div className="flex items-center justify-center gap-2 mb-2">
                  {dailyChallenge.status === 1 ? (
                    <IoCheckmarkCircle className="text-emerald-400 text-base" />
                  ) : (
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                  )}
                  <span
                    className={`font-semibold ${
                      dailyChallenge.status === 1
                        ? "text-emerald-400"
                        : "text-blue-400"
                    }`}
                  >
                    {dailyChallenge.status === 1
                      ? "Challenge Completed"
                      : "Daily Challenge"}
                  </span>
                </div>

                {progressData && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[0.7rem]">
                      <span className="text-slate-400">Progress</span>
                      <span className={showSuccess ? "text-emerald-300" : "text-blue-300"}>
                        {"kind" in progressData &&
                        progressData.kind === "combo"
                          ? `${Math.round(progressData.overall)}%`
                          : `${Math.round(progressData.progress)}%`}
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-1.5">
                      <motion.div
                        className="h-full rounded-full"
                        initial={{ width: 0 }}
                        animate={{
                          width:
                            "kind" in progressData && progressData.kind === "combo"
                              ? `${progressData.overall}%`
                              : `${Math.min(progressData.progress, 100)}%`,
                          backgroundColor: showSuccess ? "#10b981" : "#3b82f6",
                        }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                      />
                    </div>

                    {("kind" in progressData && progressData.kind === "combo") && (
                      <div className="pt-2 space-y-1">
                        <div className="flex justify-between text-[0.7rem]">
                          <span className="text-slate-400">WPM</span>
                          <span className="text-slate-200">
                            {progressData.wpm.current}/{progressData.wpm.target}
                          </span>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-1.5">
                          <motion.div
                            className="h-full rounded-full"
                            initial={{ width: 0 }}
                            animate={{
                              width: `${Math.min(progressData.wpm.progress, 100)}%`,
                              backgroundColor: showSuccess ? "#10b981" : "#60a5fa",
                            }}
                            transition={{ duration: 0.45, ease: "easeInOut" }}
                          />
                        </div>

                        <div className="flex justify-between text-[0.7rem]">
                          <span className="text-slate-400">Accuracy</span>
                          <span className="text-slate-200">
                            {progressData.acc.current}%/{progressData.acc.target}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-1.5">
                          <motion.div
                            className="h-full rounded-full"
                            initial={{ width: 0 }}
                            animate={{
                              width: `${Math.min(progressData.acc.progress, 100)}%`,
                              backgroundColor: showSuccess ? "#10b981" : "#60a5fa",
                            }}
                            transition={{ duration: 0.45, ease: "easeInOut" }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-slate-700">
                  <p className="text-slate-400 text-xs leading-relaxed">
                    {dailyChallenge.type === "marathon" && (
                      <>
                        Type enough characters to reach the goal. Every letter
                        counts!
                      </>
                    )}
                    {dailyChallenge.type === "timeAttack" && (
                      <>
                        You need to spend enough time in typing sessions to
                        complete this challenge.
                      </>
                    )}
                    {dailyChallenge.type === "speedCombo" &&
                      typeof dailyChallenge.target === "object" && (
                        <>Hit the required WPM and accuracy in one session</>
                      )}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
