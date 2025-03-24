import { RefObject, memo } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

interface TextDisplayProps {
  text: string;
  userInput: string;
  isError: boolean;
  textRefs: RefObject<(HTMLSpanElement | null)[]>;
  fontSize: string;
  lineHeight: string;
  font: string;
}

const CharSpan = memo(
  ({
    char,
    index,
    isTyped,
    isCorrect,
    textRefs,
  }: {
    char: string;
    index: number;
    isTyped: boolean;
    isCorrect: boolean;
    textRefs: RefObject<(HTMLSpanElement | null)[]>;
  }) => {
    const getColorClass = () => {
      if (!isTyped) return "text-slate-400";
      return isCorrect ? "text-slate-100" : "text-red-500";
    };

    const isSpace = char === " ";

    return (
      <motion.span
        key={`${char}-${index}`}
        ref={(el) => {
          textRefs.current![index] = el;
        }}
        className={cn(getColorClass(), {
          "bg-red-500/60": !isCorrect && isTyped && isSpace,
        })}
        initial={{ opacity: 1, y: 0 }}
        animate={
          isTyped
            ? {
                opacity: 1,
                y: 0,
                scale: isCorrect ? [1, 1.1, 1] : 1,
              }
            : undefined
        }
        transition={
          isTyped
            ? {
                duration: 0.2,
                scale: isCorrect ? { duration: 0.3, repeat: 1 } : undefined,
                opacity: { duration: 0.2, ease: "easeOut" },
                y: { duration: 0.2, ease: "easeOut" },
              }
            : undefined
        }
        whileHover={{ scale: 1.05 }}
        custom={index}
      >
        {isSpace ? "\u00A0" : char}
      </motion.span>
    );
  }
);

CharSpan.displayName = "CharSpan";

const TextDisplay = memo(
  ({
    text,
    userInput,
    isError,
    textRefs,
    fontSize,
    lineHeight,
    font,
  }: TextDisplayProps) => {
    // تقسيم النص إلى كلمات مع المسافات التي تليها
    const wordsWithSpaces = text.match(/(\S+)(\s*)/g) || [];

    let charIndex = 0; // مؤشر لتتبع الحروف والمسافات في النص

    return (
      <div
        className={`${fontSize} ${lineHeight} transition-all duration-300 tracking-tight 
          ${isError ? "text-red-500" : "text-gray-800"} ${font} 
          break-words overflow-hidden w-full whitespace-pre-wrap`}
      >
        {wordsWithSpaces.map((wordWithSpace, wordIndex) => {
          const word = wordWithSpace.trimEnd(); // الكلمة بدون مسافات زائدة في النهاية
          const trailingSpaces = wordWithSpace.slice(word.length); // المسافات التي تلي الكلمة

          return (
            <span key={wordIndex} className="whitespace-nowrap">
              {word.split("").map((char, index) => {
                const currentCharIndex = charIndex;
                charIndex++;
                const isTyped = currentCharIndex < userInput.length;
                const isCorrect = userInput[currentCharIndex] === text[currentCharIndex];

                return (
                  <CharSpan
                    key={`${wordIndex}-${index}-word`}
                    char={char}
                    index={currentCharIndex}
                    isTyped={isTyped}
                    isCorrect={isCorrect}
                    textRefs={textRefs}
                  />
                );
              })}
              {trailingSpaces.split("").map((space, spaceIndex) => {
                const currentCharIndex = charIndex;
                charIndex++;
                const isTyped = currentCharIndex < userInput.length;
                const isCorrect = userInput[currentCharIndex] === text[currentCharIndex];

                return (
                  <CharSpan
                    key={`${wordIndex}-${spaceIndex}-space`}
                    char={space}
                    index={currentCharIndex}
                    isTyped={isTyped}
                    isCorrect={isCorrect}
                    textRefs={textRefs}
                  />
                );
              })}
            </span>
          );
        })}
      </div>
    );
  }
);

TextDisplay.displayName = "TextDisplay";

export default TextDisplay;