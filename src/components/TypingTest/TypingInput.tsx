import { ChangeEvent, RefObject } from "react";

import { cn } from "@/lib/utils";
import { useAudio } from "@/features/audio/context";


interface TypingInputProps {

  inputRef: RefObject<HTMLInputElement | null>;

  userInput: string;

  handleInputChange: (e: ChangeEvent<HTMLInputElement>) => void;

  fontSizeClassName?: string;
  lineHeightClassName?: string;

  dir?: "ltr" | "rtl";
  lang?: string;

}

export default function TypingInput({
  inputRef,
  userInput,
  handleInputChange,
  fontSizeClassName = "text-xl",
  lineHeightClassName,
  dir,
  lang,
}: TypingInputProps) {
  const audio = useAudio();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const isComposing = (e.nativeEvent as unknown as { isComposing?: boolean } | null)?.isComposing === true;
    if (!isComposing) {
      audio.playKeyForEvent({
        code: e.code,
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
      });

      if (e.key === "Tab") {
        // Let higher-level handlers use Tab for next/reset.
        e.preventDefault();
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      handleInputChange({
        target: { value: userInput + " " },
      } as React.ChangeEvent<HTMLInputElement>);
    }
  };
  return (
    <input
      ref={inputRef}
      type="text"
      value={userInput}
      onChange={handleInputChange}
      onKeyDown={handleKeyDown} 
      onBlur={() => inputRef.current?.focus()} // إعادة التركيز عند فقدانه


      className={cn(
        "w-full p-4 border-none outline-none bg-transparent absolute top-0 left-0 opacity-0",
        fontSizeClassName,
        lineHeightClassName
      )}
      dir={dir}
      lang={lang}
    />
  );
}
