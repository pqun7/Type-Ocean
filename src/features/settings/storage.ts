import { z } from "zod";

import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  FontScale,
  SETTINGS_STORAGE_KEY,
} from "./types";
import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";

const FontScaleSchema = z.custom<FontScale>((v) => v === "default" || v === "large" || v === "xlarge");

const TypingLanguageSchema = z.custom<TypingLanguage>(
  (v) => v === "en" || v === "ar" || v === "es" || v === "fr"
);

const AppSettingsSchema = z.object({
  showSessionChart: z.boolean().optional(),
  reduceMotion: z.boolean().optional(),
  hideXpNotifications: z.boolean().optional(),
  fontScale: FontScaleSchema.optional(),
  soundEffectsMuted: z.boolean().optional(),
  soundEffectsVolume: z.number().min(0).max(100).optional(),
  typingLanguage: TypingLanguageSchema.optional(),
});

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_APP_SETTINGS;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;

    const json: unknown = JSON.parse(raw);
    const parsed = AppSettingsSchema.safeParse(json);
    if (!parsed.success) return DEFAULT_APP_SETTINGS;

    return {
      ...DEFAULT_APP_SETTINGS,
      ...parsed.data,
    };
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
