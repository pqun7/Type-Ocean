import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";
import type { KeyboardPerformanceData } from "@/components/TypingTest/utils/keyboardPerformance";

export const OVERALL_KEYBOARD_PERFORMANCE_VERSION = 1;

type KeyPerf = { correct: number; error: number };

export type OverallKeyboardPerformanceSnapshot = {
  version: number;
  updatedAt: string;
  lastLanguage: TypingLanguage;
  sessions: number;
  total: Record<string, KeyPerf>;
  byLanguage: Record<TypingLanguage, Record<string, KeyPerf>>;
};

const LANGUAGES: TypingLanguage[] = ["en", "ar"];

function createEmptyBucket(): Record<string, KeyPerf> {
  return {};
}

function createEmptySnapshot(language: TypingLanguage): OverallKeyboardPerformanceSnapshot {
  return {
    version: OVERALL_KEYBOARD_PERFORMANCE_VERSION,
    updatedAt: new Date(0).toISOString(),
    lastLanguage: language,
    sessions: 0,
    total: createEmptyBucket(),
    byLanguage: {
      en: createEmptyBucket(),
      ar: createEmptyBucket(),
    },
  };
}

function mergeIntoBucket(target: Record<string, KeyPerf>, delta: KeyboardPerformanceData) {
  for (const [keyId, counts] of Object.entries(delta)) {
    if (!counts) continue;
    const current = target[keyId] ?? { correct: 0, error: 0 };
    current.correct += Math.max(0, counts.correct || 0);
    current.error += Math.max(0, counts.error || 0);
    target[keyId] = current;
  }
}

function buildStorageKey(userId: string): string {
  return `typing:overallKeyboardPerformance:v${OVERALL_KEYBOARD_PERFORMANCE_VERSION}:${userId}`;
}

export function parseOverallKeyboardPerformance(raw: string | null): OverallKeyboardPerformanceSnapshot | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<OverallKeyboardPerformanceSnapshot>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== OVERALL_KEYBOARD_PERFORMANCE_VERSION) return null;

    const safeLanguage = LANGUAGES.includes(parsed.lastLanguage as TypingLanguage)
      ? (parsed.lastLanguage as TypingLanguage)
      : "en";

    return {
      version: OVERALL_KEYBOARD_PERFORMANCE_VERSION,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      lastLanguage: safeLanguage,
      sessions: Math.max(0, Number(parsed.sessions ?? 0)),
      total: (parsed.total as Record<string, KeyPerf>) ?? {},
      byLanguage: {
        en: ((parsed.byLanguage as Record<string, Record<string, KeyPerf>> | undefined)?.en ?? {}) as Record<string, KeyPerf>,
        ar: ((parsed.byLanguage as Record<string, Record<string, KeyPerf>> | undefined)?.ar ?? {}) as Record<string, KeyPerf>,
      },
    };
  } catch {
    return null;
  }
}

export function readOverallKeyboardPerformance(userId: string): OverallKeyboardPerformanceSnapshot | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(buildStorageKey(userId));
  return parseOverallKeyboardPerformance(raw);
}

export function appendOverallKeyboardPerformance(
  userId: string,
  language: TypingLanguage,
  sessionData: KeyboardPerformanceData
): OverallKeyboardPerformanceSnapshot | null {
  if (typeof window === "undefined") return null;
  if (!userId) return null;

  const hasData = Object.values(sessionData).some((v) => v && (v.correct > 0 || v.error > 0));
  if (!hasData) return null;

  const key = buildStorageKey(userId);
  const current = parseOverallKeyboardPerformance(window.localStorage.getItem(key)) ?? createEmptySnapshot(language);

  mergeIntoBucket(current.total, sessionData);
  mergeIntoBucket(current.byLanguage[language], sessionData);

  current.lastLanguage = language;
  current.sessions += 1;
  current.updatedAt = new Date().toISOString();

  window.localStorage.setItem(key, JSON.stringify(current));
  return current;
}

export function getTotalsFromPerformance(data: KeyboardPerformanceData | undefined) {
  const totals = { correct: 0, error: 0 };
  if (!data) return totals;

  for (const value of Object.values(data)) {
    if (!value) continue;
    totals.correct += Math.max(0, value.correct || 0);
    totals.error += Math.max(0, value.error || 0);
  }

  return totals;
}
