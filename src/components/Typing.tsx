"use client";
import { useState, useEffect, useCallback } from "react";
import LevelsDock from "@/components/ui/levels-dock";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { textsData } from "@/components/TypingTest/data/dataText";
import ResultsChart from "@/components/TypingTest/ResultsChart";

const TypingTest = dynamic(() => import("@/components/TypingTest/TypingTest"), {
  ssr: false,
  loading: () => <p className="text-slate-200 animate-softPulse">Loading...</p>,
});

type Level = "SHORT" | "MEDIUM" | "LONG";

const textsDataByLevel: Record<Level, { content: string }[]> = textsData.reduce(
  (acc, text) => {
    acc[text.type] = acc[text.type] || [];
    acc[text.type].push({ content: text.content });
    return acc;
  },
  { SHORT: [], MEDIUM: [], LONG: [] } as Record<Level, { content: string }[]>
);

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
  const [selectedLevel, setSelectedLevel] = useState<Level>("MEDIUM");
  const [gameState, setGameState] = useState<"start" | "running" | "end">(
    "start"
  );
  const [text, setText] = useState<string | null>(null);
  const [textKey, setTextKey] = useState(0);
  const [currentWpm, setCurrentWpm] = useState(0);
  const [currentAccuracy, setCurrentAccuracy] = useState(100);
  const [isIdle, setIsIdle] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const [wpmHistory, setWpmHistory] = useState<{ time: number; wpm: number; prevWpm: number }[][]>([]);
  const [errorTimes, setErrorTimes] = useState<number[]>([]);


  const selectNewText = useCallback(
    (level: Level = selectedLevel) => {
      let selectedText: string | null = null;

      if (texts?.length) {
        selectedText = texts[Math.floor(Math.random() * texts.length)];
      } else {
        const levelTexts = textsDataByLevel[level];
        if (levelTexts.length) {
          selectedText =
            levelTexts[Math.floor(Math.random() * levelTexts.length)].content;
        } else {
          selectedText = "No text available for this level.";
        }
      }

      setText(selectedText);
    },
    [selectedLevel, texts]
  );

  const handleLevelSelect = (level: Level) => {
    setSelectedLevel(level);
    selectNewText(level);
    setTextKey((prev) => prev + 1);
    setGameState("start");
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        selectNewText(selectedLevel);
        setTextKey((prev) => prev + 1);
        setGameState("start");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLevel, selectNewText]);

  useEffect(() => {
    selectNewText(selectedLevel);
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
          errorTimes={errorTimes}
        />
      )}
      <div className={`relative w-screen h-fit min-h-[350px] px-10 font-grotesk ${className}`}>
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
              <p className="w-full flex justify-center items-center text-center text-gray-200 text-3xl py-5">
                Try it yourself
              </p>
            )}
          </div>

          <div className="flex justify-center items-center py-5">
            <TypingTest
              key={textKey}
              texts={texts ? texts : [text || "Loading..."]}
              onStateChange={setGameState}
              fontSize={fontSize}
              caretHeight="h-4 md:h-5"
              font="font-jetbrains"
              onWpmChange={setCurrentWpm}
              onAccuracyChange={setCurrentAccuracy}
              onIdleChange={setIsIdle}
              onElapsedTimeChange={setCurrentTime}
              className="w-[1200px] mt-4 overflow-x-auto"
              onWpmHistoryChange={setWpmHistory}
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
