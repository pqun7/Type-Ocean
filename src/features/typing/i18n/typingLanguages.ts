export type TypingLanguage = "en" | "ar" | "es" | "fr";

export type TypingDirection = "ltr" | "rtl";

export const TYPING_LANGUAGES: Record<
  TypingLanguage,
  { label: string; dir: TypingDirection; locale: string }
> = {
  en: { label: "English", dir: "ltr", locale: "en" },
  ar: { label: "Arabic", dir: "rtl", locale: "ar" },
  es: { label: "Spanish", dir: "ltr", locale: "es" },
  fr: { label: "French", dir: "ltr", locale: "fr" },
};

export function getTypingDir(language: TypingLanguage): TypingDirection {
  return TYPING_LANGUAGES[language].dir;
}

export function getTypingLocale(language: TypingLanguage): string {
  return TYPING_LANGUAGES[language].locale;
}
