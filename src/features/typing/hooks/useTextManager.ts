// hooks/useTextManager.ts
"use client";

import { useState, useEffect, useCallback } from "react";
import shortEn from "@/features/typing/data/en/short.json";
import mediumEn from "@/features/typing/data/en/medium.json";
import longEn from "@/features/typing/data/en/long.json";

import shortAr from "@/features/typing/data/ar/short.json";
import mediumAr from "@/features/typing/data/ar/medium.json";
import longAr from "@/features/typing/data/ar/long.json";

import shortEs from "@/features/typing/data/es/short.json";
import mediumEs from "@/features/typing/data/es/medium.json";
import longEs from "@/features/typing/data/es/long.json";

import shortFr from "@/features/typing/data/fr/short.json";
import mediumFr from "@/features/typing/data/fr/medium.json";
import longFr from "@/features/typing/data/fr/long.json";

import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";

type Level = "SHORT" | "MEDIUM" | "LONG";

type TextItem = { id: number; content: string };
type TextSelectionMode = "smart" | "random" | "daily";

const HISTORY_SIZE = 20;

const TEXT_BANKS: Record<TypingLanguage, Record<Level, TextItem[]>> = {
  en: {
    SHORT: shortEn as TextItem[],
    MEDIUM: mediumEn as TextItem[],
    LONG: longEn as TextItem[],
  },
  ar: {
    SHORT: shortAr as TextItem[],
    MEDIUM: mediumAr as TextItem[],
    LONG: longAr as TextItem[],
  },
  es: {
    SHORT: shortEs as TextItem[],
    MEDIUM: mediumEs as TextItem[],
    LONG: longEs as TextItem[],
  },
  fr: {
    SHORT: shortFr as TextItem[],
    MEDIUM: mediumFr as TextItem[],
    LONG: longFr as TextItem[],
  },
};

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getDayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function difficultyScore(text: string): number {
  const len = text.length;
  const punctuation = (text.match(/[.,;:!?"'()\-]/g) ?? []).length;
  const longWords = (() => {
    // Unicode-aware long-word heuristic (handles Arabic/Devanagari/etc.).
    // Fallback keeps older/limited-regex environments working.
    try {
      return (text.match(/[\p{L}\p{N}]{9,}/gu) ?? []).length;
    } catch {
      return (text.match(/\b\w{9,}\b/g) ?? []).length;
    }
  })();
  return len + punctuation * 6 + longWords * 10;
}

function hashStringToInt(value: string): number {
  // Small deterministic hash for daily selection.
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getHistoryKey(level: Level): string {
  return `typing:textHistory:${level}`;
}

function getLastResultKey(level: Level): string {
  return `typing:lastResult:${level}`;
}

function getHistoryKeyV2(language: TypingLanguage, level: Level): string {
  return `typing:textHistory:${language}:${level}`;
}

function getLastResultKeyV2(language: TypingLanguage, level: Level): string {
  return `typing:lastResult:${language}:${level}`;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export default function useTextManager(
  selectedLevel: Level,
  mode: TextSelectionMode = "smart",
  typingLanguage: TypingLanguage = "en"
) {
  const [text, setText] = useState<string>("");

  const getTextsByLevel = useCallback((language: TypingLanguage, level: Level): TextItem[] => {
    return TEXT_BANKS[language]?.[level] ?? TEXT_BANKS.en[level];
  }, []);

  const getTextForLevel = useCallback((level: Level) => {
    const texts = getTextsByLevel(typingLanguage, level);
    if (!texts.length) return "";

    // Daily selection: deterministic per-day, per-level.
    if (mode === "daily") {
      const dayKey = getDayKey();
      const seed = `${dayKey}:${typingLanguage}:${level}`;
      const idx = hashStringToInt(seed) % texts.length;
      return texts[idx]?.content ?? texts[0]!.content;
    }

    // Random selection: original behavior.
    if (mode === "random") {
      return pickRandom(texts).content;
    }

    // Smart selection:
    // - avoid repeating recent texts
    // - pick easier/harder texts based on last session performance
    const storageAvailable = typeof window !== "undefined" && !!window.localStorage;
    const historyKey = getHistoryKeyV2(typingLanguage, level);
    const lastResultKey = getLastResultKeyV2(typingLanguage, level);

    // Backward compatibility: read old keys for English only.
    const legacyHistoryKey = typingLanguage === "en" ? getHistoryKey(level) : null;
    const legacyLastResultKey = typingLanguage === "en" ? getLastResultKey(level) : null;

    const historyIds = storageAvailable
      ? safeParseJson<number[]>(
          localStorage.getItem(historyKey) ?? (legacyHistoryKey ? localStorage.getItem(legacyHistoryKey) : null)
        ) ?? []
      : [];

    const lastResult = storageAvailable
      ? safeParseJson<{ wpm: number; accuracy: number; ts: number; textLength: number }>(
          localStorage.getItem(lastResultKey) ?? (legacyLastResultKey ? localStorage.getItem(legacyLastResultKey) : null)
        )
      : null;

    const scored = texts
      .map((t) => ({ ...t, score: difficultyScore(t.content) }))
      .sort((a, b) => a.score - b.score);

    // Choose a target band: easier / medium / harder.
    const wpm = lastResult?.wpm ?? 0;
    const acc = lastResult?.accuracy ?? 100;
    let band: "easy" | "mid" | "hard" = "mid";
    if (wpm && acc) {
      if (acc < 92 || wpm < 35) band = "easy";
      else if (acc > 97 && wpm > 70) band = "hard";
      else band = "mid";
    }

    const n = scored.length;
    const easyEnd = Math.max(1, Math.floor(n * 0.35));
    const midStart = Math.floor(n * 0.25);
    const midEnd = Math.max(midStart + 1, Math.floor(n * 0.75));
    const hardStart = Math.floor(n * 0.6);

    const bandPool =
      band === "easy"
        ? scored.slice(0, easyEnd)
        : band === "hard"
          ? scored.slice(hardStart)
          : scored.slice(midStart, midEnd);

    const withoutRecent = bandPool.filter((t) => !historyIds.includes(t.id));
    const candidates = withoutRecent.length ? withoutRecent : bandPool;
    const chosen = pickRandom(candidates);

    if (storageAvailable) {
      const nextHistory = [chosen.id, ...historyIds.filter((id) => id !== chosen.id)].slice(
        0,
        HISTORY_SIZE
      );
      localStorage.setItem(historyKey, JSON.stringify(nextHistory));

      // Opportunistic migration for English: write legacy key too so old code paths (if any) keep working.
      if (typingLanguage === "en") {
        localStorage.setItem(getHistoryKey(level), JSON.stringify(nextHistory));
      }
    }

    return chosen.content;
  }, [getTextsByLevel, mode, typingLanguage]);

  const resetText = useCallback(
    (levelOverride?: Level) => {
      const targetLevel = levelOverride ?? selectedLevel;
      const newText = getTextForLevel(targetLevel);
      setText(newText);
    },
    [getTextForLevel, selectedLevel]
  );

  useEffect(() => {
    resetText();
  }, [resetText]);

  return { text, resetText };
}