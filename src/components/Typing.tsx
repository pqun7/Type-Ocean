"use client";
import { useState, useEffect } from "react";
import LevelsDock from "@/components/ui/levels-dock";
import { motion, AnimatePresence } from "framer-motion";
import ResultsChart from "@/components/TypingTest/ResultsChart";
import TypingTest from "@/components/TypingTest/TypingTest";
import { TextType } from "@/features/typing/types/typing";
import { useSettings } from "@/features/settings/context";
import { getTypingTypography } from "@/features/settings/typingTypography";

export type Mode = "course" | "game" | "practice" | "online";


const HeaderGame = ({
  texts,
  HomePage = false,
  className,
  fontSize = "text-xl md:text-2xl",
}: {
  texts?: string[];
  HomePage?: boolean;
  className?: string;
  fontSize?: string;
}) => {
  const { settings } = useSettings();

  const [selectedLevel, setSelectedLevel] = useState<TextType>("SHORT");
  const [gameState, setGameState] = useState<"start" | "running" | "end">(
    "start"
  );
  const text: string = "This whole Web was built by just one person… so trust me, you can achieve anything!";
  const [textKey, setTextKey] = useState(0);
  const [currentWpm, setCurrentWpm] = useState(0);
  const [currentAccuracy, setCurrentAccuracy] = useState(100);
  const [isIdle, setIsIdle] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const [wpmHistory, setWpmHistory] = useState<
    { time: number; wpm: number; prevWpm: number }[][]
  >([]);
  const [currentErrors, setCurrentErrors] = useState(0);

  

  const handleLevelSelect = (level: TextType) => {
    setSelectedLevel(level);
    setTextKey((prev) => prev + 1);
    setGameState("start");
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        setTextKey(prev => prev + 1);       
        setGameState("start");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLevel]);

  useEffect(() => {
    setTextKey((prev) => prev + 1);
  }, []);

  const typography = HomePage
    ? { fontSize, lineHeight: "leading-8", caretHeight: "h-4 md:h-5" }
    : getTypingTypography(settings.fontScale);

  const optimizePerformance = !settings.showSessionChart;

  return (
    <>
      {gameState === "end" && (
        <ResultsChart
          wpm={currentWpm}
          accuracy={currentAccuracy}
          gameState={gameState}
          currentTime={currentTime}
          wpmHistory={wpmHistory}
          currentErrors={currentErrors}
          optimizePerformance={optimizePerformance}
        />
      )}


      <div
        className={`relative w-screen h-fit min-h-[350px] px-10 font-grotesk ${className} scale-[0.88]`}
      >
        {gameState === "running" && <Idle isIdle={isIdle} />}

        <div className="flex flex-col w-full h-full gap-4 font-jetbrains">
          <div className="flex justify-between items-center w-full border-b border-gray-600 py-2 flex-col sm:flex-row">
            {!HomePage ? (
              <>
                <div className="sm:w-[14rem] text-left text-gray-400 text-lg flex justify-start pl-4 mt-4">
                  WPM: <span className="font-bold">{currentWpm}</span>
                </div>
                <div className="sm:w-1/2 flex justify-end pr-4 scale-90">
                  <LevelsDock
                    levels={["SHORT", "MEDIUM", "LONG"]}
                    onLevelSelect={handleLevelSelect}
                    selectedLevel={selectedLevel}
                  />
                </div>
              </>
            ) : (
              <p className="w-full flex justify-center items-center text-center text-gray-200 text-3xl py-5 font-bold">
                Try it yourself
              </p>
            )}
          </div>

          <div className="flex justify-center items-center py-5">
            <TypingTest
              className="w-[1200px] mt-4 overflow-hidden"
              caretHeight={typography.caretHeight}
              font="font-jetbrains"
              key={textKey}
              texts={texts ? texts : [text || "Loading..."]}
              onStateChange={setGameState}
              fontSize={typography.fontSize}
              lineHeight={typography.lineHeight}
              typingLanguage={settings.typingLanguage}
              onWpmChange={setCurrentWpm}
              onAccuracyChange={setCurrentAccuracy}
              onIdleChange={setIsIdle}
              onElapsedTimeChange={setCurrentTime}
              onWpmHistoryChange={setWpmHistory}
              onErrorsChange={setCurrentErrors}
              selectedLevel={selectedLevel}
            />
          </div>
        </div>
      </div>
    </>
  );
};

const Idle = ({ isIdle }: { isIdle: boolean }) => {
  return (
    <AnimatePresence>
      {isIdle && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(20,30,50,0.85) 0%, transparent 80%)',
          }}
        >
          <motion.div
            initial={{ scale: 0.9, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 10 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="text-center p-6 rounded-xl border border-[rgba(160,220,255,0.2)] bg-[rgba(20,50,80,0.4)] backdrop-blur-md shadow-2xl max-w-sm mx-4"
          >
            <div className="flex justify-center mb-3">
              <div className="w-12 h-12 rounded-full bg-[rgba(160,220,255,0.1)] flex items-center justify-center border border-[rgba(160,220,255,0.3)]">
                <svg className="w-6 h-6 text-cyan-300 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                </svg>
              </div>
            </div>
            <p className="text-2xl font-bold bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent mb-2">
              Ready to continue?
            </p>
            <p className="text-[#8A8FB5] text-sm">
              Your progress is safe. Press any key to resume typing.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default HeaderGame;
