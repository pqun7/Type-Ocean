import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";
import {
  DEFAULT_ARABIC_TYPING_FONT,
  DEFAULT_ENGLISH_TYPING_FONT,
  type ArabicTypingFontId,
  type EnglishTypingFontId,
} from "./typingFonts";

export type FontScale = "default" | "large" | "xlarge";

export type AppSettings = {
  showSessionChart: boolean;
  reduceMotion: boolean;
  hideXpNotifications: boolean;
  fontScale: FontScale;
  englishTypingFont: EnglishTypingFontId;
  arabicTypingFont: ArabicTypingFontId;
  soundEffectsMuted: boolean;
  soundEffectsVolume: number; // 0-100
  typingLanguage: TypingLanguage;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  showSessionChart: true,
  reduceMotion: false,
  hideXpNotifications: false,
  fontScale: "default",
  englishTypingFont: DEFAULT_ENGLISH_TYPING_FONT,
  arabicTypingFont: DEFAULT_ARABIC_TYPING_FONT,
  soundEffectsMuted: true,
  soundEffectsVolume: 35,
  typingLanguage: "en",
};

export const SETTINGS_STORAGE_KEY = "type-ocean:settings:v1";
