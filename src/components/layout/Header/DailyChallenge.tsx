import { useLevel } from "@/contexts/hook/useLevel";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IoCheckmarkCircle } from "react-icons/io5";
import { IoCheckmarkOutline } from "react-icons/io5";

export const DailyChallenge = () => {
  const { dailyChallenge } = useLevel();
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);

  useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength());
    }
  }, []);

  useEffect(() => {
    if (dailyChallenge?.status === 1) {
      setShowSuccess(true);
      const exitTimer = setTimeout(() => {
        setIsVisible(false);
      }, 1000);

      return () => {
        clearTimeout(exitTimer);
      };
    }
  }, [dailyChallenge?.status]);

  const getChallengeDescription = () => {
    if (!dailyChallenge) return "";

    switch (dailyChallenge.type) {
      case "speedCombo":
        if (
          typeof dailyChallenge.target === "object" &&
          "wpm" in dailyChallenge.target &&
          "accuracy" in dailyChallenge.target
        ) {
          return `${dailyChallenge.target.wpm} WPM & ${dailyChallenge.target.accuracy}%`;
        }
        return "";
      case "marathon":
        return `${
          Number(dailyChallenge.target) -
          (dailyChallenge.data?.charactersTyped ?? 0)
        } chars left`;
      case "timeAttack":
        const currentMinutes = Math.floor(
          (dailyChallenge.data?.timeSpent || 0) / 60
        );
        const targetMinutes = Math.floor(Number(dailyChallenge.target) / 60);
        return `${targetMinutes - currentMinutes} min left`;
      default:
        return "";
    }
  };

  const getProgressData = () => {
    if (!dailyChallenge || dailyChallenge.status === 1) return null;

    switch (dailyChallenge.type) {
      case "marathon":
        return {
          current: dailyChallenge.data?.charactersTyped || 0,
          target: dailyChallenge.target as number,
          label: "chars",
          progress:
            ((dailyChallenge.data?.charactersTyped || 0) /
              (dailyChallenge.target as number)) *
            100,
        };
      case "timeAttack":
        const currentSeconds = dailyChallenge.data?.timeSpent || 0;
        return {
          current: Math.floor(currentSeconds / 60),
          target: Math.floor((dailyChallenge.target as number) / 60),
          label: "minutes",
          progress: (currentSeconds / (dailyChallenge.target as number)) * 100,
        };
      default:
        return null;
    }
  };

  const progressData = getProgressData();

  return (
    <AnimatePresence>
 
      {isVisible && (
        <motion.div
          className="relative flex items-center gap-2"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{
            opacity: 0,
            scale: 0.5,
            transition: { duration: 0.3, delay: 0.2 },
          }}
        >
          <motion.div
            className={`flex items-center justify-start cursor-pointer
            ${showSuccess ? "bg-emerald-500/90" : "bg-slate-800/70"}
            border-2 border-blue-400/30 rounded-full overflow-hidden`}
            initial={{ width: 30 }}
            animate={{
              width: showSuccess ? 30 : isHovered ? 150 : 30,
              transition: { type: "spring", stiffness: 200, damping: 30 },
            }}
            style={{ height: 30 }}
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
                  animate={{ rotate: 0, scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <motion.path
                    ref={pathRef}
                    d="M6 12L10.5 16.5L18 7.5"
                    initial={{
                      strokeDasharray: pathLength,
                      strokeDashoffset: pathLength,
                    }}
                    animate={{
                      strokeDashoffset: 0,
                      transition: { duration: 0.5 }
                    }}
                    exit={{
                      strokeDashoffset: pathLength,
                      transition: { duration: 0.3 }
                    }}
                    strokeLinecap="round"
                  />
                </motion.svg>
              ) : (
                <>
                  <motion.span
                    className="absolute inset-0 bg-blue-500/20 rounded-full"
                    animate={{
                      scale:
                        dailyChallenge?.status === 0 && !isHovered
                          ? [1, 1.2, 1]
                          : 1,
                      opacity:
                        dailyChallenge?.status === 0 && !isHovered
                          ? [0.4, 0.8, 0.4]
                          : 0,
                    }}
                    transition={{
                      duration: 1.5,
                      repeat:
                        dailyChallenge?.status === 0 && !isHovered
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

            {dailyChallenge && (
              <motion.div
                className={`pr-10 pl-7 whitespace-nowrap text-xs font-medium w-full
              ${isHovered ? "text-left" : "text-right"}
              ${dailyChallenge.status === 1 ? "text-white" : "text-blue-300"}`}
              >
                {getChallengeDescription()}
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
                className="absolute top-full mt-2 left-1/4 transform -translate-x-1/2 px-3 py-2 bg-slate-800 text-xs text-slate-300 rounded-md shadow-lg border border-slate-700 min-w-[220px] z-50"
              >
                <div className="absolute -top-[7px] left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800 border-t border-l border-slate-700 rotate-45 transform" />

                <div className="flex items-center justify-center gap-2 mb-2">
                  {dailyChallenge?.status === 1 ? (
                    <IoCheckmarkCircle className="text-emerald-400 text-base" />
                  ) : (
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                  )}
                  <span
                    className={`font-semibold ${
                      dailyChallenge?.status === 1
                        ? "text-emerald-400"
                        : "text-blue-400"
                    }`}
                  >
                    {dailyChallenge?.status === 1
                      ? "Challenge Completed"
                      : "Daily Challenge"}
                  </span>
                </div>

                {progressData && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[0.7rem]">
                      <span className="text-slate-400">Progress</span>
                      <span className="text-blue-300">
                        {Math.min(Math.round(progressData.progress), 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-1.5">
                      <motion.div
                        className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full"
                        initial={{ width: 0 }}
                        animate={{
                          width: `${Math.min(progressData.progress, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {dailyChallenge && (
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
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
