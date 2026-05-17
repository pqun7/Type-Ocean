export type TypingLanguage = "en" | "ar";

export type TypingDirection = "ltr" | "rtl";

export const TYPING_LANGUAGES: Record<
  TypingLanguage,
  { label: string; dir: TypingDirection; locale: string }
> = {
  en: { label: "English", dir: "ltr", locale: "en" },
  ar: { label: "Arabic", dir: "rtl", locale: "ar" },
};

export function getTypingDir(language: TypingLanguage): TypingDirection {
  return TYPING_LANGUAGES[language].dir;
}

export function getTypingLocale(language: TypingLanguage): string {
  return TYPING_LANGUAGES[language].locale;
}
