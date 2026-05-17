import { z } from "zod";

import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  FontScale,
  SETTINGS_STORAGE_KEY,
} from "./types";
import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";
import {
  isArabicTypingFontId,
  isEnglishTypingFontId,
  type ArabicTypingFontId,
  type EnglishTypingFontId,
} from "./typingFonts";

const FontScaleSchema = z.custom<FontScale>((v) => v === "default" || v === "large" || v === "xlarge");

const TypingLanguageSchema = z.custom<TypingLanguage>(
  (v) => v === "en" || v === "ar"
);

const EnglishTypingFontSchema = z.custom<EnglishTypingFontId>((v) =>
  isEnglishTypingFontId(v)
);

const ArabicTypingFontSchema = z.custom<ArabicTypingFontId>((v) =>
  isArabicTypingFontId(v)
);

const AppSettingsSchema = z.object({
  showSessionChart: z.boolean().optional(),
  reduceMotion: z.boolean().optional(),
  hideXpNotifications: z.boolean().optional(),
  fontScale: FontScaleSchema.optional(),
  englishTypingFont: EnglishTypingFontSchema.optional(),
  arabicTypingFont: ArabicTypingFontSchema.optional(),
  soundEffectsMuted: z.boolean().optional(),
  soundEffectsVolume: z.number().min(0).max(100).optional(),
  typingLanguage: TypingLanguageSchema.optional(),
});

export function parseAppSettings(input: unknown): AppSettings {
  const parsed = AppSettingsSchema.safeParse(input);
  if (!parsed.success) return DEFAULT_APP_SETTINGS;

  return {
    ...DEFAULT_APP_SETTINGS,
    ...parsed.data,
  };
}

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_APP_SETTINGS;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;

    const json: unknown = JSON.parse(raw);
    return parseAppSettings(json);
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(next: AppSettings): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function resetAppSettings(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // ignore
  }
}
