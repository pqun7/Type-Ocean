import { ChangeEvent, RefObject } from "react";


interface TypingInputProps {

  inputRef: RefObject<HTMLInputElement | null>;

  userInput: string;

  handleInputChange: (e: ChangeEvent<HTMLInputElement>) => void;

}

export default function TypingInput({ inputRef, userInput, handleInputChange }: TypingInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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

      className="text-xl w-full p-4 border-none outline-none bg-transparent absolute top-0 left-0 opacity-0"
      dir="ltr"
    />
  );
}
