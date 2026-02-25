import type { FontScale } from "./types";

export type TypingTypography = {
  fontSize: string;
  lineHeight: string;
  caretHeight: string;
};

export function getTypingTypography(scale: FontScale): TypingTypography {
  switch (scale) {
    case "large":
      return {
        fontSize: "text-2xl md:text-3xl",
        lineHeight: "leading-10 md:leading-[3rem]",
        caretHeight: "h-6 md:h-7",
      };
    case "xlarge":
      return {
        fontSize: "text-3xl md:text-4xl",
        lineHeight: "leading-[2.75rem] md:leading-[3.5rem]",
        caretHeight: "h-7 md:h-8",
      };
    case "default":
    default:
      return {
        fontSize: "text-xl md:text-2xl",
        lineHeight: "leading-8 md:leading-10",
        caretHeight: "h-5 md:h-6",
      };
  }
}
