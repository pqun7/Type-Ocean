import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { playerProfiles } from "@/db/schema";
import { connectIfNeeded, redis } from "@/lib/redis";
import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";
import type { KeyboardPerformanceData } from "@/components/TypingTest/utils/keyboardPerformance";

export const OVERALL_KEYBOARD_VERSION = 1;
const REDIS_KEY_PREFIX = `user:keyboard:overall:v${OVERALL_KEYBOARD_VERSION}:`;
const SNAPSHOT_FIELD = "keyboardPerformance";
const DB_SNAPSHOT_EVERY_SESSIONS = 5;

type KeyPerf = { correct: number; error: number };

type KeyBucket = Record<string, KeyPerf>;

export type OverallKeyboardPerformanceSnapshot = {
  version: number;
  updatedAt: string;
  lastLanguage: TypingLanguage;
  sessions: number;
  total: KeyBucket;
  byLanguage: Record<TypingLanguage, KeyBucket>;
};

const LANGUAGES: TypingLanguage[] = ["en", "ar"];

function emptyBucket(): KeyBucket {
  return {};
}

export function createEmptyOverallKeyboardSnapshot(
  language: TypingLanguage = "en"
): OverallKeyboardPerformanceSnapshot {
  return {
    version: OVERALL_KEYBOARD_VERSION,
    updatedAt: new Date().toISOString(),
    lastLanguage: language,
    sessions: 0,
    total: emptyBucket(),
    byLanguage: {
      en: emptyBucket(),
      ar: emptyBucket(),
    },
  };
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizeBucket(value: unknown): KeyBucket {
  if (!value || typeof value !== "object") return {};

  const out: KeyBucket = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const typed = raw as { correct?: unknown; error?: unknown };
    const correct = toNonNegativeInt(typed.correct);
    const error = toNonNegativeInt(typed.error);
    if (correct === 0 && error === 0) continue;
    out[key] = { correct, error };
  }

  return out;
}

export function normalizeOverallKeyboardSnapshot(
  raw: unknown
): OverallKeyboardPerformanceSnapshot | null {
  if (!raw || typeof raw !== "object") return null;

  const input = raw as Partial<OverallKeyboardPerformanceSnapshot>;
  if (input.version !== OVERALL_KEYBOARD_VERSION) return null;

  const safeLanguage = LANGUAGES.includes(input.lastLanguage as TypingLanguage)
    ? (input.lastLanguage as TypingLanguage)
    : "en";

  return {
    version: OVERALL_KEYBOARD_VERSION,
    updatedAt:
      typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
    lastLanguage: safeLanguage,
    sessions: toNonNegativeInt(input.sessions),
    total: normalizeBucket(input.total),
    byLanguage: {
      en: normalizeBucket(input.byLanguage?.en),
      ar: normalizeBucket(input.byLanguage?.ar),
    },
  };
}

function mergeBucket(target: KeyBucket, delta: KeyboardPerformanceData): boolean {
  let changed = false;

  for (const [keyId, counts] of Object.entries(delta)) {
    if (!counts) continue;

    const addCorrect = toNonNegativeInt(counts.correct);
    const addError = toNonNegativeInt(counts.error);
    if (addCorrect === 0 && addError === 0) continue;

    const current = target[keyId] ?? { correct: 0, error: 0 };
    const next = {
      correct: current.correct + addCorrect,
      error: current.error + addError,
    };

    target[keyId] = next;
    changed = true;
  }

  return changed;
}

export function mergeOverallKeyboardSnapshot(
  current: OverallKeyboardPerformanceSnapshot,
  language: TypingLanguage,
  sessionDelta: KeyboardPerformanceData
): OverallKeyboardPerformanceSnapshot {
  const next: OverallKeyboardPerformanceSnapshot = {
    ...current,
    total: { ...current.total },
    byLanguage: {
      en: { ...current.byLanguage.en },
      ar: { ...current.byLanguage.ar },
    },
  };

  const changedTotal = mergeBucket(next.total, sessionDelta);
  const changedLang = mergeBucket(next.byLanguage[language], sessionDelta);

  if (!changedTotal && !changedLang) return current;

  next.lastLanguage = language;
  next.sessions += 1;
  next.updatedAt = new Date().toISOString();
  return next;
}

function hasAnyPerformanceData(data: KeyboardPerformanceData): boolean {
  return Object.values(data).some((v) => {
    if (!v) return false;
    return toNonNegativeInt(v.correct) + toNonNegativeInt(v.error) > 0;
  });
}

function redisKey(userId: string): string {
  return `${REDIS_KEY_PREFIX}${userId}`;
}

async function readFromRedis(userId: string): Promise<OverallKeyboardPerformanceSnapshot | null> {
  try {
    await connectIfNeeded();
    const raw = await redis.get(redisKey(userId));
    if (!raw) return null;
    return normalizeOverallKeyboardSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function readFromProfileSnapshot(
  userId: string
): Promise<OverallKeyboardPerformanceSnapshot | null> {
  try {
    const profileRows = await db
      .select({ longTermStats: playerProfiles.longTermStats })
      .from(playerProfiles)
      .where(eq(playerProfiles.userId, userId))
      .limit(1);

    const profile = profileRows[0] ?? null;

    if (!profile?.longTermStats || typeof profile.longTermStats !== "object") return null;
    const raw = (profile.longTermStats as Record<string, unknown>)[SNAPSHOT_FIELD];
    return normalizeOverallKeyboardSnapshot(raw);
  } catch {
    return null;
  }
}

async function writeToRedis(userId: string, snapshot: OverallKeyboardPerformanceSnapshot) {
  try {
    await connectIfNeeded();
    await redis.set(redisKey(userId), JSON.stringify(snapshot));
  } catch {
    // best effort
  }
}

async function writeDbSnapshot(userId: string, snapshot: OverallKeyboardPerformanceSnapshot) {
  const profileRows = await db
    .select({ longTermStats: playerProfiles.longTermStats })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId))
    .limit(1);

  const profile = profileRows[0] ?? null;

  if (!profile) return;

  const current =
    profile.longTermStats && typeof profile.longTermStats === "object"
      ? (profile.longTermStats as Record<string, unknown>)
      : {};

  await db
    .update(playerProfiles)
    .set({
      longTermStats: {
        ...current,
        [SNAPSHOT_FIELD]: snapshot,
      },
      updatedAt: new Date(),
    })
    .where(eq(playerProfiles.userId, userId));
}

export async function getOverallKeyboardPerformance(
  userId: string
): Promise<OverallKeyboardPerformanceSnapshot | null> {
  const redisSnapshot = await readFromRedis(userId);
  if (redisSnapshot) return redisSnapshot;

  const dbSnapshot = await readFromProfileSnapshot(userId);
  if (dbSnapshot) {
    await writeToRedis(userId, dbSnapshot);
    return dbSnapshot;
  }

  return null;
}

export async function appendOverallKeyboardPerformance(
  userId: string,
  language: TypingLanguage,
  sessionDelta: KeyboardPerformanceData
): Promise<OverallKeyboardPerformanceSnapshot | null> {
  if (!userId) return null;
  if (!hasAnyPerformanceData(sessionDelta)) return null;

  const current = (await getOverallKeyboardPerformance(userId)) ??
    createEmptyOverallKeyboardSnapshot(language);

  const next = mergeOverallKeyboardSnapshot(current, language, sessionDelta);
  if (next === current) return current;

  await writeToRedis(userId, next);

  if (next.sessions <= 1 || next.sessions % DB_SNAPSHOT_EVERY_SESSIONS === 0) {
    try {
      await writeDbSnapshot(userId, next);
    } catch {
      // keep fast-path unaffected when DB snapshot fails
    }
  }

  return next;
}
