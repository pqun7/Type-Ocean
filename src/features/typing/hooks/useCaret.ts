import { useEffect, useState, useRef, useCallback } from "react";

function getCaretYOffset(ref?: HTMLElement | null): number {
  const h = ref?.offsetHeight;
  if (typeof h === "number" && Number.isFinite(h) && h > 0) {
    // Historical offset was ~6.5px for typical 32px line height → ~20%.
    return h * 0.2;
  }
  return 6.5;
}

export function getCaretPositionForIndex(params: {
  textRefs: Array<HTMLSpanElement | null>;
  caretIndex: number;
  fallback?: { x: number; y: number };
  dir?: "ltr" | "rtl";
}): { x: number; y: number } {
  const fallback = params.fallback ?? { x: 16, y: 18 };
  const caretIndex = Math.max(0, params.caretIndex);
  const dir = params.dir ?? "ltr";

  const currentCharRef = params.textRefs[caretIndex - 1];
  const nextCharRef = params.textRefs[caretIndex];
  const yOffset = getCaretYOffset(nextCharRef ?? currentCharRef);

  const rightEdge = (el: HTMLElement) => el.offsetLeft + el.offsetWidth;

  if (!currentCharRef && nextCharRef) {
    return {
      x: dir === "rtl" ? rightEdge(nextCharRef) : nextCharRef.offsetLeft,
      y: nextCharRef.offsetTop + yOffset,
    };
  }

  if (!currentCharRef) {
    return fallback;
  }

  if (nextCharRef && nextCharRef.offsetTop > currentCharRef.offsetTop) {
    return {
      x: dir === "rtl" ? rightEdge(nextCharRef) : nextCharRef.offsetLeft,
      y: nextCharRef.offsetTop + yOffset,
    };
  }

  return {
    x: dir === "rtl" ? currentCharRef.offsetLeft : currentCharRef.offsetLeft + currentCharRef.offsetWidth,
    y: currentCharRef.offsetTop + yOffset,
  };
}

export default function useCaret(userInput: string, text: string, dir: "ltr" | "rtl" = "ltr") {
  const textRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [caretPosition, setCaretPosition] = useState<{ x: number; y: number }>({ x: 16, y: 18 });

  const getCaretPosition = useCallback((): { x: number; y: number } => {
    const caretIndex = Math.min(userInput.length, text.length);
    return getCaretPositionForIndex({ textRefs: textRefs.current, caretIndex, fallback: { x: 16, y: 18 }, dir });
  }, [dir, userInput, text]);

  useEffect(() => {
    const newPos = getCaretPosition();
    if (newPos.x !== caretPosition.x || newPos.y !== caretPosition.y) {
      setCaretPosition(newPos);
    }
  }, [getCaretPosition, caretPosition]);

  return { caretPosition, textRefs };
}