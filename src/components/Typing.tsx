"use client";
import { useState, useEffect, useCallback } from "react";
import LevelsDock from "@/components/ui/levels-dock";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { textsData } from "@/components/TypingTest/data/dataText";
import { NumberAnimation } from "./core/number-animation";
import  AreaResult  from "@/components/TypingTest/AreaChart";

const TypingTest = dynamic(() => import("@/components/TypingTest/TypingTest"), {
  ssr: false,
  loading: () => (
    <p className="text-slate-200 animate-softPulse">Loading...</p>
  ),
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
}: {
  texts?: string[];
  HomePage?: boolean;
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
    <div className="relative w-[1200px] h-[500px] min-h-[350px] px-6 font-grotesk overflow-hidden">
      {/* <Results
        wpm={currentWpm}
        accuracy={currentAccuracy}
        gameState={gameState}
        currentTime={currentTime}
      /> */}
      {gameState === 'end' && <AreaResult />}
      
      {gameState === "running" && <Idle isIdle={isIdle} />}

      <div className="flex flex-col w-full h-full gap-4 font-jetbrains">
        <div className="flex justify-between items-center w-full border-b border-gray-600 py-4">
          {!HomePage ? (
            <>
              <div className="w-36 text-left text-gray-400 pl-4 text-lg flex justify-center items-center gap-4">
                WPM: <span className="font-bold">{currentWpm}</span>
                Time: <span className="font-bold">{currentTime}</span>

              </div>
              <div className="w-1/2 flex justify-end pr-4 scale-90">
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
            fontSize="text-base md:text-xl lg:text-2xl"
            caretHeight="h-3 md:h-4 lg:h-5"
            font="font-fira"
            onWpmChange={setCurrentWpm}
            onAccuracyChange={setCurrentAccuracy}
            onIdleChange={setIsIdle}
            onElapsedTimeChange={setCurrentTime}
            className="w-[1200px] mt-4 overflow-x-auto"
          />
        </div>
      </div>
    </div>
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

const Results = ({
  wpm,
  accuracy,
  gameState,
  currentTime,
}: {
  wpm: number;
  accuracy: number;
  gameState: "start" | "running" | "end";
  currentTime: number;
}) => {
  const minutes = Math.floor(currentTime / 60);
  const seconds = currentTime % 60;

  return (
    <AnimatePresence>
      {gameState === "end" && (
        <motion.div
          initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
          animate={{ opacity: 1, backdropFilter: "blur(16px)" }}
          exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 flex items-center justify-center bg-[rgba(10,30,50,0.9)]/30 z-5 rounded-2xl"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5 }}
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.05)_0%,transparent_90%)]"
          />
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0, scale: 0.8 }}
            transition={{
              type: "spring",
              stiffness: 100,
              damping: 15,
              delay: 0.3,
            }}
            className="p-8 rounded-2xl text-center space-y-6 relative z-20"
          >
            <motion.p className="text-4xl font-bold text-[rgba(200,240,255,0.95)]">
              <span className="text-[rgba(160,220,255,1)]">
                <NumberAnimation
                  value={wpm}
                  color="rgba(160,220,255,1)"
                  delay={0.4}
                />
              </span>{" "}
              WPM
            </motion.p>
            <motion.p className="text-xl text-[rgba(200,240,255,0.9)]">
              accuracy:{" "}
              <span className="text-[rgba(80,210,150,1)] font-medium underline">
                <NumberAnimation
                  value={Math.min(100, Math.max(0, accuracy))}
                  unit="%"
                  color="rgba(80,210,150,1)"
                  delay={0.4}
                />
              </span>
            </motion.p>
            <motion.p className="text-xl text-[rgba(200,240,255,0.9)]">
              Time:{" "}
              <span className="text-[rgba(80,210,150,1)] font-medium">
                {minutes > 0 && (
                  <>
                    <NumberAnimation
                      value={minutes}
                      color="rgba(80,210,150,1)"
                      delay={0.4}
                    />
                    m{" "}
                  </>
                )}
                <NumberAnimation
                  value={seconds}
                  color="rgba(80,210,150,1)"
                  delay={0.4}
                />
                s
              </span>
            </motion.p>
            <motion.p
              animate={{ scale: [1, 1.03, 1] }}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="text-lg text-[rgba(160,220,255,1)] italic tracking-wide"
            >
              Press Tab to restart
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default HeaderGame;