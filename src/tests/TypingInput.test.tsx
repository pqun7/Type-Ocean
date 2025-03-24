// tests/TypingInput.test.tsx
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import TypingInput from "@/components/TypingTest/TypingInput";

describe("TypingInput Component", () => {
  test("calls handleInputChange when input changes", () => {
    const handleInputChange = jest.fn();
    const inputRef = { current: null } as React.MutableRefObject<HTMLInputElement | null>;

    const { getByRole } = render(
      <TypingInput inputRef={inputRef} userInput="" handleInputChange={handleInputChange} />
    );

    const inputElement = getByRole("textbox");

    // محاكاة تغيير قيمة الإدخال
    fireEvent.change(inputElement, { target: { value: "Hello" } });
    expect(handleInputChange).toHaveBeenCalled();
  });

  test("appends space when Enter key is pressed", () => {
    const handleInputChange = jest.fn();
    const inputRef = { current: null } as React.MutableRefObject<HTMLInputElement | null>;

    const { getByRole } = render(
      <TypingInput inputRef={inputRef} userInput="Test" handleInputChange={handleInputChange} />
    );
    const inputElement = getByRole("textbox");

    // محاكاة ضغط مفتاح Enter
    fireEvent.keyDown(inputElement, { key: "Enter", code: "Enter" });
    // عند ضغط Enter يجب أن يتم استدعاء الدالة مع قيمة محدثة (مثلاً "Test " مع فراغ في النهاية)
    expect(handleInputChange).toHaveBeenCalledWith(expect.objectContaining({ target: { value: "Test " } }));
  });
});
