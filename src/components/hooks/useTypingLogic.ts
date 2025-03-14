import { useState } from "react";

type State = "start" | "running" | "end";

export default function useTypingLogic(text: string, resetText: () => void) {
  const [userInput, setUserInput] = useState<string>("");
  const [isError, setIsError] = useState<boolean>(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [wpm, setWpm] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number>(100);
  const [state, setState] = useState<State>("start");

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;

    // Initialize start time on first input
    if (!startTime) setStartTime(Date.now());

    setUserInput(input);
    setIsError(text.slice(0, input.length) !== input);

    // Calculate accuracy
    const correctChars = text
      .split("")
      .reduce((acc, char, i) => acc + (input[i] === char ? 1 : 0), 0);
    const newAccuracy = (correctChars / input.length) * 100;
    setAccuracy(input.length ? newAccuracy : 100);

    // Calculate WPM
    const timeElapsed = (Date.now() - (startTime || Date.now())) / 60000;
    const wordsTyped = input.trim().split(/\s+/).length;
    setWpm(timeElapsed > 0 ? Math.round(wordsTyped / timeElapsed) : 0);

    // Transition to "end" when input matches text length
    if (input.length === text.length) setTimeout(resetGame, 500);
  };

  const resetGame = (): void => {
    resetText();
    setUserInput("");
    setIsError(false);
    setStartTime(null);
    setWpm(0);
    setAccuracy(100);
  };

  return { userInput, isError, wpm, accuracy, handleInputChange, resetGame, state };
}