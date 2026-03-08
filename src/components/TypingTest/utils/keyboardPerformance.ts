import { segmentGraphemes } from "@/features/typing/utils/graphemes";
import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";

export type KeyboardPerformanceData = Record<
  string,
  { correct: number; error: number } | undefined
>;

const BASE_SYMBOL_MAP: Record<string, string> = {
  "`": "Backtick",
  "~": "Backtick",
  "1": "1",
  "!": "1",
  "2": "2",
  "@": "2",
  "3": "3",
  "#": "3",
  "4": "4",
  "$": "4",
  "5": "5",
  "%": "5",
  "6": "6",
  "^": "6",
  "7": "7",
  "&": "7",
  "8": "8",
  "*": "8",
  "9": "9",
  "(": "9",
  "0": "0",
  ")": "0",
  "[": "BracketLeft",
  "{": "BracketLeft",
  "]": "BracketRight",
  "}": "BracketRight",
  "\\": "Backslash",
  "|": "Backslash",
  ";": "Semicolon",
  ":": "Semicolon",
  "'": "Quote",
  '"': "Quote",
  ",": "Comma",
  "<": "Comma",
  ".": "Period",
  ">": "Period",
  "/": "Slash",
  "?": "Slash",
};

const ARABIC_TO_KEY_MAP: Record<string, string> = {
  "ذ": "Backtick",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "٠": "0",

  "ض": "q",
  "ص": "w",
  "ث": "e",
  "ق": "r",
  "ف": "t",
  "غ": "y",
  "ع": "u",
  "ه": "i",
  "خ": "o",
  "ح": "p",
  "ج": "BracketLeft",
  "د": "BracketRight",
  "\\": "Backslash",

  "ش": "a",
  "س": "s",
  "ي": "d",
  "ب": "f",
  "ل": "g",
  "ا": "h",
  "ت": "j",
  "ن": "k",
  "م": "l",
  "ك": "Semicolon",
  "ط": "Quote",

  "ئ": "z",
  "ء": "x",
  "ؤ": "c",
  "ر": "v",
  "لا": "b",
  "ى": "n",
  "ة": "m",
  "و": "Comma",
  "ز": "Period",
  "ظ": "Slash",

  "،": "Comma",
  "؛": "Semicolon",
  "؟": "Slash",
  "َ": "q",
  "ُ": "w",
  "ِ": "e",
  "ّ": "r",
  "ْ": "x",
};

const SPANISH_EXTRA_MAP: Record<string, string> = {
  ñ: "Semicolon",
};

const FRENCH_LETTER_TO_KEY_MAP: Record<string, string> = {
  a: "q",
  q: "a",
  z: "w",
  w: "z",
  m: "Semicolon",
};

const FRENCH_SYMBOL_MAP: Record<string, string> = {
  "&": "1",
  "é": "2",
  '"': "3",
  "'": "4",
  "(": "5",
  "-": "6",
  "è": "7",
  "_": "8",
  "ç": "9",
  "à": "0",
  ")": "BracketRight",
  "=": "Backslash",
  "ù": "Quote",
};

const SHIFT_SYMBOLS_EN_ES = new Set([
  "~",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "{",
  "}",
  "|",
  ":",
  '"',
  "<",
  ">",
  "?",
]);

const SHIFT_SYMBOLS_FR = new Set([
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
]);

const SHIFT_CHARS_AR = new Set([
  "َ",
  "ُ",
  "ِ",
  "ّ",
  "ْ",
  "؟",
]);

const SHIFT_KEYS = ["ShiftLeft", "ShiftRight"] as const;

function bumpKey(
  data: KeyboardPerformanceData,
  keyId: string,
  type: "correct" | "error"
) {
  const current = data[keyId] ?? { correct: 0, error: 0 };
  current[type] += 1;
  data[keyId] = current;
}

function normalizeDiacritics(char: string): string {
  return char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

function isUppercaseLetter(char: string): boolean {
  const normalized = normalizeDiacritics(char);
  if (!/^[a-z]$/iu.test(normalized)) return false;
  return normalized === normalized.toUpperCase() && normalized !== normalized.toLowerCase();
}

function getUppercaseRunLength(segments: { segment: string }[], index: number): number {
  if (!segments[index] || !isUppercaseLetter(segments[index]!.segment)) return 0;

  let start = index;
  let end = index;

  while (start > 0 && isUppercaseLetter(segments[start - 1]!.segment)) start -= 1;
  while (end < segments.length - 1 && isUppercaseLetter(segments[end + 1]!.segment)) end += 1;

  return end - start + 1;
}

function requiresShift(char: string, language: TypingLanguage): boolean {
  if (language === "ar") return SHIFT_CHARS_AR.has(char);
  if (language === "fr") return SHIFT_SYMBOLS_FR.has(char) || SHIFT_SYMBOLS_EN_ES.has(char);
  return SHIFT_SYMBOLS_EN_ES.has(char);
}

function getRequiredModifier(
  char: string,
  language: TypingLanguage,
  expectedSegments: { segment: string }[],
  index: number
): "shift" | "caps" | null {
  if (requiresShift(char, language)) return "shift";

  if (language !== "ar" && isUppercaseLetter(char)) {
    const runLength = getUppercaseRunLength(expectedSegments, index);
    return runLength >= 2 ? "caps" : "shift";
  }

  return null;
}

export function mapCharacterToKeyId(
  rawChar: string,
  language: TypingLanguage
): string | null {
  if (!rawChar) return null;
  if (isWhitespace(rawChar)) return "Space";

  const char = rawChar.toLowerCase();

  if (language === "ar") {
    if (ARABIC_TO_KEY_MAP[char]) return ARABIC_TO_KEY_MAP[char]!;
    if (BASE_SYMBOL_MAP[char]) return BASE_SYMBOL_MAP[char]!;
    return null;
  }

  if (BASE_SYMBOL_MAP[char]) return BASE_SYMBOL_MAP[char]!;

  const latinNormalized = normalizeDiacritics(char);

  if (language === "fr") {
    if (FRENCH_SYMBOL_MAP[char]) return FRENCH_SYMBOL_MAP[char]!;
    if (FRENCH_LETTER_TO_KEY_MAP[latinNormalized]) {
      return FRENCH_LETTER_TO_KEY_MAP[latinNormalized]!;
    }
    if (/^[a-z]$/u.test(latinNormalized)) return latinNormalized;
    return null;
  }

  if (language === "es") {
    if (SPANISH_EXTRA_MAP[char]) return SPANISH_EXTRA_MAP[char]!;
    if (/^[a-z]$/u.test(latinNormalized)) return latinNormalized;
    return null;
  }

  if (/^[a-z]$/u.test(latinNormalized)) return latinNormalized;
  return null;
}

export function buildKeyboardPerformanceData(
  expectedText: string,
  typedText: string,
  language: TypingLanguage
): KeyboardPerformanceData {
  const expectedSegments = segmentGraphemes(expectedText, language);
  const typedSegments = segmentGraphemes(typedText, language);
  const typedLength = Math.min(expectedSegments.length, typedSegments.length);

  const performanceData: KeyboardPerformanceData = {};

  for (let index = 0; index < typedLength; index += 1) {
    const expected = expectedSegments[index]?.segment;
    const typed = typedSegments[index]?.segment;
    if (!expected || !typed) continue;

    const keyId = mapCharacterToKeyId(expected, language);
    const isCorrect = typed === expected;

    if (keyId) {
      bumpKey(performanceData, keyId, isCorrect ? "correct" : "error");
    }

    const modifier = getRequiredModifier(expected, language, expectedSegments, index);
    if (!modifier) continue;

    if (modifier === "caps") {
      bumpKey(performanceData, "CapsLock", isCorrect ? "correct" : "error");
      continue;
    }

    for (const shiftKey of SHIFT_KEYS) {
      bumpKey(performanceData, shiftKey, isCorrect ? "correct" : "error");
    }
  }

  return performanceData;
}
