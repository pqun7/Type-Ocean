import { useEffect, useState, useRef, useCallback } from "react";

export default function useCaret(userInput: string, text: string) {
  const textRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [caretPosition, setCaretPosition] = useState<{ x: number; y: number }>({ x: 16, y: 18 });

  const getCaretPosition = useCallback((): { x: number; y: number } => {
    // if (userInput.length === 0) {
    //   const firstCharRef = textRefs.current[0];
    //   return firstCharRef
    //     ? { x: firstCharRef.offsetLeft, y: firstCharRef.offsetTop + 3 }
    //     : { x: 0, y: 3 };
    // }
  
    const caretIndex = Math.min(userInput.length, text.length);
    const currentCharRef = textRefs.current[caretIndex - 1];
    const nextCharRef = textRefs.current[caretIndex];
  
    if (!currentCharRef && nextCharRef) {
      return { x: nextCharRef.offsetLeft, y: nextCharRef.offsetTop + 3 };
    }
  
    if (!currentCharRef) {
      return { x: 16, y: 18 };
    }
  
    if (nextCharRef && nextCharRef.offsetTop > currentCharRef.offsetTop) {
      return { x: nextCharRef.offsetLeft, y: nextCharRef.offsetTop + 3 };
    }
  
    return {
      x: currentCharRef.offsetLeft + currentCharRef.offsetWidth,
      y: currentCharRef.offsetTop + 3,
    };
  }, [userInput, text]);

  useEffect(() => {
    const newPos = getCaretPosition();
    if (newPos.x !== caretPosition.x || newPos.y !== caretPosition.y) {
      setCaretPosition(newPos);
    }
  }, [getCaretPosition, caretPosition]);

  return { caretPosition, textRefs };
}