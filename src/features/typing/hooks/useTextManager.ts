// hooks/useTextManager.ts
"use client";

import { useState, useEffect } from "react";
import short from "@/features/typing/data/short.json";
import medium from "@/features/typing/data/medium.json";
import long from "@/features/typing/data/long.json";

type Level = "SHORT" | "MEDIUM" | "LONG";

type TextItem = { id: number; content: string };
type TextSelectionMode = "smart" | "random" | "daily";

const HISTORY_SIZE = 20;

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
  const longWords = (text.match(/\b\w{9,}\b/g) ?? []).length;
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

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export default function useTextManager(
  selectedLevel: Level,
  mode: TextSelectionMode = "smart"
) {
  const [text, setText] = useState<string>("");

  const getTextsByLevel = (level: Level) => {
    switch (level) {
      case "SHORT":
        return short as TextItem[];
      case "MEDIUM":
        return medium as TextItem[];
      case "LONG":
        return long as TextItem[];
      default:
        return medium as TextItem[];
    }
  };

  const getTextForLevel = (level: Level) => {
    const texts = getTextsByLevel(level);
    if (!texts.length) return "";

    // Daily selection: deterministic per-day, per-level.
    if (mode === "daily") {
      const dayKey = getDayKey();
      const seed = `${dayKey}:${level}`;
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
    const historyIds = storageAvailable
      ? safeParseJson<number[]>(localStorage.getItem(getHistoryKey(level))) ?? []
      : [];

    const lastResult = storageAvailable
      ? safeParseJson<{ wpm: number; accuracy: number; ts: number; textLength: number }>(
          localStorage.getItem(getLastResultKey(level))
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
      localStorage.setItem(getHistoryKey(level), JSON.stringify(nextHistory));
    }

    return chosen.content;
  };

  const resetText = (levelOverride?: Level) => {
    const targetLevel = levelOverride ?? selectedLevel;
    const newText = getTextForLevel(targetLevel);
    setText(newText);
  };

  useEffect(() => {
    resetText();
  }, [selectedLevel, mode]);

  return { text, resetText };
}