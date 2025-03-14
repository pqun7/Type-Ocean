import { useState } from "react";

export default function useTextManager(texts: string[]) {
  const [text, setText] = useState<string>(texts[0]);

  const getRandomText = (): string => {
    return texts[Math.floor(Math.random() * texts.length)];
  };

  const resetText = () => {
    setText(getRandomText());
  };

  return { text, setText, resetText };
}