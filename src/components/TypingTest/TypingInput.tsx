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
  disabled?: boolean;

}

export default function TypingInput({
  inputRef,
  userInput,
  handleInputChange,
  fontSizeClassName = "text-xl",
  lineHeightClassName,
  dir,
  lang,
  disabled = false,
}: TypingInputProps) {
  const audio = useAudio();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const isComposing = (e.nativeEvent as unknown as { isComposing?: boolean } | null)?.isComposing === true;
    if (!isComposing) {
      if (e.key === "Tab") {
        audio.playKeySfx("tab");
        // Let higher-level handlers use Tab for next/reset.
        e.preventDefault();
      } else if (e.key === "Enter") {
        audio.playKeySfx("enter");
      } else if (e.key === " " || e.code === "Space") {
        audio.playKeySfx("space");
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        audio.playKeySfx("key");
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
      onBlur={() => {
        if (!disabled) {
          inputRef.current?.focus();
        }
      }}
      disabled={disabled}


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
