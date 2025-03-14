import { motion } from "framer-motion";
import TextDisplay from "./TextDisplay";
import TypingInput from "./TypingInput";
import Caret from "./Caret";
import Stats from "./Stats";
import useTypingTest from "../hooks/useTypingGame";

interface TypingTestProps {
  texts: string[];
  fontSize?: string;
  lineHeight?: string;
  font?: string;
  caretHeight?: string;
}


export default function TypingTest({
  texts,
  fontSize = "text-xl",
  lineHeight = "leading-8",
  font = "font-mono",
  caretHeight = "h-6",
}: TypingTestProps) {
  const {
    text,
    userInput,
    isError,
    wpm,
    accuracy,
    caretPosition,
    handleInputChange,
    resetGame,
    inputRef,
    textRefs,
  } = useTypingTest(texts);

  return (
   
      <>

        {/* <Stats wpm={wpm} accuracy={accuracy} /> */}

        <div className="relative w-full h-full rounded-md p-4 ">
          <TextDisplay
            text={text}
            userInput={userInput}
            isError={isError}
            textRefs={textRefs}
            fontSize={fontSize}
            lineHeight={lineHeight}
            font={font}
          />
          <Caret caretPosition={caretPosition} caretHeight={caretHeight}/>
          <TypingInput
            inputRef={inputRef}
            userInput={userInput}
            handleInputChange={handleInputChange}
          />
        </div>

        {/* <motion.button
          onClick={resetGame}
          className="mt-6 w-full py-2 text-lg bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-300 shadow-md"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          Start Over
        </motion.button> */}
      </>
  );
}