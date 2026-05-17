import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";

export type EnglishTypingFontId =
  | "jetbrains-mono"
  | "inter"
  | "open-sans"
  | "roboto"
  | "source-sans-3"
  | "atkinson";

export type ArabicTypingFontId =
  | "cairo"
  | "tajawal"
  | "noto-sans-arabic"
  | "amiri"
  | "lemonada"
  | "sf-arabic";

export type TypingFontOption<T extends string> = {
  id: T;
  label: string;
  description: string;
  sample: string;
  cssFamily: string;
};

export const DEFAULT_ENGLISH_TYPING_FONT: EnglishTypingFontId = "jetbrains-mono";
export const DEFAULT_ARABIC_TYPING_FONT: ArabicTypingFontId = "cairo";

export const ENGLISH_TYPING_FONT_OPTIONS: TypingFontOption<EnglishTypingFontId>[] = [
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    description: "Precise and coding-friendly",
    sample: "The tide rewards steady rhythm.",
    cssFamily: '"JetBrains Mono", "Fira Code", "IBM Plex Mono", monospace',
  },
  {
    id: "inter",
    label: "Inter",
    description: "Modern and balanced",
    sample: "The tide rewards steady rhythm.",
    cssFamily: '"Inter", "Open Sans", system-ui, sans-serif',
  },
  {
    id: "open-sans",
    label: "Open Sans",
    description: "Readable and calm",
    sample: "The tide rewards steady rhythm.",
    cssFamily: '"Open Sans", "Inter", sans-serif',
  },
  {
    id: "roboto",
    label: "Roboto",
    description: "Neutral and familiar",
    sample: "The tide rewards steady rhythm.",
    cssFamily: '"Roboto", "Inter", sans-serif',
  },
  {
    id: "source-sans-3",
    label: "Source Sans 3",
    description: "Soft and editorial",
    sample: "The tide rewards steady rhythm.",
    cssFamily: '"Source Sans 3", "Open Sans", sans-serif',
  },
  {
    id: "atkinson",
    label: "Atkinson Hyperlegible",
    description: "Accessibility-first clarity",
    sample: "The tide rewards steady rhythm.",
    cssFamily: '"Atkinson Hyperlegible", "Inter", sans-serif',
  },
];

export const ARABIC_TYPING_FONT_OPTIONS: TypingFontOption<ArabicTypingFontId>[] = [
  {
    id: "cairo",
    label: "Cairo",
    description: "Modern and balanced",
    sample: "الكتابة الواضحة تصنع إيقاعًا أجمل.",
    cssFamily: '"Cairo", "Noto Sans Arabic", "Tajawal", sans-serif',
  },
  {
    id: "tajawal",
    label: "Tajawal",
    description: "Clean and light",
    sample: "الكتابة الواضحة تصنع إيقاعًا أجمل.",
    cssFamily: '"Tajawal", "Cairo", "Noto Sans Arabic", sans-serif',
  },
  {
    id: "noto-sans-arabic",
    label: "Noto Sans Arabic",
    description: "Neutral and highly readable",
    sample: "الكتابة الواضحة تصنع إيقاعًا أجمل.",
    cssFamily: '"Noto Sans Arabic", "Cairo", sans-serif',
  },
  {
    id: "amiri",
    label: "Amiri",
    description: "Traditional with elegant strokes",
    sample: "الكتابة الواضحة تصنع إيقاعًا أجمل.",
    cssFamily: '"Amiri", "Noto Sans Arabic", serif',
  },
  {
    id: "lemonada",
    label: "Lemonada",
    description: "Expressive and playful",
    sample: "الكتابة الواضحة تصنع إيقاعًا أجمل.",
    cssFamily: '"Lemonada", "Cairo", sans-serif',
  },
  {
    id: "sf-arabic",
    label: "SF Arabic",
    description: "Compact and polished",
    sample: "الكتابة الواضحة تصنع إيقاعًا أجمل.",
    cssFamily: '"SF Arabic", "Cairo", "Noto Sans Arabic", sans-serif',
  },
];

const englishFontsById = Object.fromEntries(
  ENGLISH_TYPING_FONT_OPTIONS.map((option) => [option.id, option])
) as Record<EnglishTypingFontId, TypingFontOption<EnglishTypingFontId>>;

const arabicFontsById = Object.fromEntries(
  ARABIC_TYPING_FONT_OPTIONS.map((option) => [option.id, option])
) as Record<ArabicTypingFontId, TypingFontOption<ArabicTypingFontId>>;

export function isEnglishTypingFontId(value: unknown): value is EnglishTypingFontId {
  return typeof value === "string" && value in englishFontsById;
}

export function isArabicTypingFontId(value: unknown): value is ArabicTypingFontId {
  return typeof value === "string" && value in arabicFontsById;
}

export function getEnglishTypingFontOption(id: EnglishTypingFontId) {
  return englishFontsById[id] ?? englishFontsById[DEFAULT_ENGLISH_TYPING_FONT];
}

export function getArabicTypingFontOption(id: ArabicTypingFontId) {
  return arabicFontsById[id] ?? arabicFontsById[DEFAULT_ARABIC_TYPING_FONT];
}

export function getTypingFontClass(language: TypingLanguage): "font-user-english" | "font-user-arabic" {
  return language === "ar" ? "font-user-arabic" : "font-user-english";
}