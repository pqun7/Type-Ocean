/**
 * Component that displays a blinking caret (cursor) at the current typing position. It dynamically positions
 * itself next to the last typed character using refs and animates to indicate the active typing spot.
 *
 * How it works:
 * - Uses refs to track the position of the last typed character.
 * - Updates its position whenever the user types or deletes a character.
 * - Applies a blinking animation for visual feedback.
 */
import { motion } from "framer-motion";
import { set } from "lodash";
import { useEffect, useState, useRef } from "react";

// Caret component to display a blinking cursor at the current typing position
const Caret = ({
  position,
  userInput,
  charactersRef, // Refs from UserTypings in typing.tsx to calculate position
  height = "h-6",
  width = "w-0.5",
}: {
  position: number;
  userInput: string;
  charactersRef: React.MutableRefObject<(HTMLSpanElement | null)[]>;
  height?: string;
  width?: string;
}) => {
  const [caretYposition, setCaretYposition] = useState(0);
  const [caretXposition, setCaretXposition] = useState(0);

  const caretRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (charactersRef.current[0]) {
      const { left } = charactersRef.current[0].getBoundingClientRect();
      setCaretXposition(left);
    }
  }, [charactersRef]);

  useEffect(() => {
    const currentCharElement = charactersRef.current[position - 1];
    if (currentCharElement) {
      const { top, height } = currentCharElement.getBoundingClientRect();
      const newCaretY = top + height / 4;
      setCaretYposition(newCaretY);
  
      if (caretRef.current) {
        caretRef.current.style.transform = `translateY(${newCaretY}px)`;
      }
    }
  }, [position, userInput]); 
  
  return (
    <motion.div
      aria-hidden
      className={`absolute bg-blue-400 ${width} ${height} top-3`}
      initial={{ opacity: 1, scaleY: 1 }}
      animate={{
        x: position * 16.5,
        opacity: [1, 0.3, 1], 
        scaleY: [1, 0.7, 1],
      }}
      transition={{
        x: { type: "spring", stiffness: 300, damping: 20 },
        duration: 1.1,
        ease: "easeInOut",
        repeat: Infinity,
        repeatType: "mirror",
      }}
    />
  );
};

export default Caret;
