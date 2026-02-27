export type FontScale = "default" | "large" | "xlarge";
import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";

export type AppSettings = {
  showSessionChart: boolean;
  reduceMotion: boolean;
  hideXpNotifications: boolean;
  fontScale: FontScale;
  soundEffectsMuted: boolean;
  soundEffectsVolume: number; // 0-100
  typingLanguage: TypingLanguage;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  showSessionChart: true,
  reduceMotion: false,
  hideXpNotifications: false,
  fontScale: "default",
  soundEffectsMuted: true,
  soundEffectsVolume: 35,
  typingLanguage: "en",
};

export const SETTINGS_STORAGE_KEY = "type-ocean:settings:v1";
