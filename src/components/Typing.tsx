"use client";
import { useState, useEffect, useCallback } from "react";
import LevelsDock from "@/components/ui/levels-dock";
import { motion, AnimatePresence, useSpring } from "framer-motion";
import ResultsChart from "@/components/TypingTest/ResultsChart";
import TypingTest from "@/components/TypingTest/TypingTest";
import { TextType } from "@/types/typing";

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
    setTextKey(prev => prev + 1);
    setTextKey((prev) => prev + 1);
  }, []);

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
          optimizePerformance = {true}
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
              caretHeight="h-4 md:h-5"
              font="font-jetbrains"
              key={textKey}
              texts={texts ? texts : [text || "Loading..."]}
              onStateChange={setGameState}
              fontSize={fontSize}
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
          className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 rounded-xl"
        >
          <div className="text-center p-4 text-gray-200">
            <p className="text-xl mb-2">✍️ Keep typing!</p>
            <p className="text-sm opacity-75">Press any key to continue...</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default HeaderGame;
