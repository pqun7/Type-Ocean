import { RefObject, memo } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

import { segmentGraphemes } from "@/features/typing/utils/graphemes";

interface TextDisplayProps {
  text: string;
  userInput: string;
  isError: boolean;
  textRefs: RefObject<(HTMLSpanElement | null)[]>;
  fontSize: string;
  lineHeight: string;
  font: string;
  optimizePerformance?: boolean;
  dir?: "ltr" | "rtl";
  lang?: string;
}

const TextDisplay = memo(
  ({
    text,
    userInput,
    isError,
    textRefs,
    fontSize,
    lineHeight,
    font,
    optimizePerformance = false,
    dir,
    lang,
  }: TextDisplayProps) => {
    const segments = segmentGraphemes(text, lang);

    const setRefRange = (el: HTMLSpanElement | null, start: number, end: number) => {
      if (!textRefs.current) return;
      for (let i = start; i < end; i += 1) {
        textRefs.current[i] = el;
      }
    };

    const getColorClass = (isTyped: boolean, isCorrect: boolean) => {
      if (!isTyped) return "text-slate-400";
      return isCorrect ? "text-slate-100" : "text-red-500";
    };

    return (
      <div
        className={`${fontSize} ${lineHeight} transition-all duration-300 tracking-tight 
          ${isError ? "text-red-500" : "text-gray-800"} ${font} 
          break-words overflow-hidden w-full  whitespace-pre-wrap pointer-events-none`}
        dir={dir}
        lang={lang}
      >
        {segments.map((seg) => {
          const isTyped = userInput.length >= seg.end;
          const isCorrect = isTyped && userInput.slice(seg.start, seg.end) === text.slice(seg.start, seg.end);
          const isSpace = seg.segment === " ";

          const className = cn(getColorClass(isTyped, isCorrect), {
            "bg-red-500/60": !isCorrect && isTyped && isSpace,
          });

          const content = isSpace ? "\u00A0" : seg.segment;

          if (optimizePerformance) {
            return (
              <span
                key={`${seg.start}-${seg.end}`}
                ref={(el) => setRefRange(el, seg.start, seg.end)}
                className={className}
              >
                {content}
              </span>
            );
          }

          return (
            <motion.span
              key={`${seg.start}-${seg.end}`}
              ref={(el) => setRefRange(el, seg.start, seg.end)}
              className={className}
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
            >
              {content}
            </motion.span>
          );
        })}
      </div>
    );
  }
);

TextDisplay.displayName = "TextDisplay";

export default TextDisplay;