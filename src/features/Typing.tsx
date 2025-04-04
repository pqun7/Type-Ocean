// features/typing-game/Typing.tsx
"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useGameStore, useProgressStore } from "./stores";
import { LevelsDock, IdleOverlay, ResultsChart, TypingTest } from "./components";

const TypingGame = ({
  texts,
  isHomePage = false,
  className,
  fontSize = "text-xl md:text-2xl",
}: {
  texts?: string[];
  isHomePage?: boolean;
  className?: string;
  fontSize?: string;
}) => {
  const {
    selectedLevel,
    gameState,
    textKey,
    currentWpm,
    currentAccuracy,
    isIdle,
    currentTime,
    wpmHistory,
    currentErrors,
    handleLevelSelect,
    resetGame
  } = useGameStore();

  const { level, userXP } = useProgressStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        resetGame();
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLevel, resetGame]);

  return (
    <div className={`relative w-screen h-fit min-h-[350px] px-10 font-grotesk ${className} scale-[0.88]`}>
      <AnimatePresence>
        {gameState === "end" && (
          <ResultsChart
            wpm={currentWpm}
            accuracy={currentAccuracy}
            currentTime={currentTime}
            wpmHistory={wpmHistory}
            errors={currentErrors}
          />
        )}
      </AnimatePresence>

      {gameState === "running" && <IdleOverlay />}

      <div className="flex flex-col w-full h-full gap-4 font-jetbrains">
        <GameHeader 
          isHomePage={isHomePage}
          currentWpm={currentWpm}
          selectedLevel={selectedLevel}
          onLevelSelect={handleLevelSelect}
          level={level}
          xp={userXP}
        />

        <TypingTest
          className="w-[1200px] mt-4 overflow-hidden"
          caretHeight="h-4 md:h-5"
          font="font-jetbrains"
          key={textKey}
          texts={texts}
          fontSize={fontSize}
          selectedLevel={selectedLevel}
        />
      </div>
    </div>
  );
};

const GameHeader = ({ 
  isHomePage,
  currentWpm,
  selectedLevel,
  onLevelSelect,
  level,
  xp
}: {
  isHomePage: boolean;
  currentWpm: number;
  selectedLevel: Level;
  onLevelSelect: (level: Level) => void;
  level: number;
  xp: number;
}) => (
  <div className="flex justify-between items-center w-full border-b border-gray-600 py-2 flex-col sm:flex-row">
    {!isHomePage ? (
      <>
        <div className="flex items-center gap-4 sm:w-[14rem] pl-4 mt-4">
          <div className="text-gray-400 text-lg">
            WPM: <span className="font-bold">{currentWpm}</span>
          </div>
          <div className="text-sm text-gray-500">
            Lv.{level} ({xp}XP)
          </div>
        </div>
        <div className="sm:w-1/2 flex justify-end pr-4 scale-90">
          <LevelsDock
            levels={["SHORT", "MEDIUM", "LONG"]}
            selectedLevel={selectedLevel}
            onSelect={onLevelSelect}
          />
        </div>
      </>
    ) : (
      <p className="w-full flex justify-center items-center text-center text-gray-200 text-3xl py-5 font-bold">
        Try it yourself
      </p>
    )}
  </div>
);

export default TypingGame;