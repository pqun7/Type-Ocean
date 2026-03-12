import { readJsonValue, writeJsonValue, type RedisLike } from "./store";

export type AntiCheatInputEvent = {
  atMs: number;
  inputLength: number;
  deltaChars: number;
  wpm: number;
};

export type AntiCheatFlag =
  | "impossible_sustained_speed"
  | "perfect_corrections"
  | "extremely_low_timing_variance"
  | "sudden_wpm_spike";

type PersistedAnomalyScore = {
  emaScore: number;
  flags: AntiCheatFlag[];
  updatedAt: number;
};

const ANTI_CHEAT_TTL_SECONDS = 7 * 24 * 60 * 60;
const EMA_ALPHA = 0.25;

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length <= 1) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function buildFlags(inputEvents: AntiCheatInputEvent[]): AntiCheatFlag[] {
  if (inputEvents.length < 3) return [];

  const flags = new Set<AntiCheatFlag>();
  const positiveEvents = inputEvents.filter((event) => event.deltaChars > 0);
  const intervals = positiveEvents
    .slice(1)
    .map((event, index) => event.atMs - positiveEvents[index]!.atMs)
    .filter((interval) => interval > 0);

  const charsPerSecond = positiveEvents
    .map((event) => {
      const prior = inputEvents.findLast((candidate) => candidate.atMs < event.atMs);
      if (!prior) return 0;
      const elapsedMs = Math.max(1, event.atMs - prior.atMs);
      return (event.deltaChars / elapsedMs) * 1000;
    })
    .filter((value) => value > 0);

  if (charsPerSecond.length >= 4 && average(charsPerSecond) > 15) {
    flags.add("impossible_sustained_speed");
  }

  if (intervals.length >= 6 && standardDeviation(intervals) < 10) {
    flags.add("extremely_low_timing_variance");
  }

  const corrections = inputEvents.filter((event) => event.deltaChars < 0);
  if (corrections.length >= 3) {
    let perfectCorrectionCount = 0;
    for (let index = 0; index < inputEvents.length - 1; index += 1) {
      const current = inputEvents[index]!;
      const next = inputEvents[index + 1]!;
      if (current.deltaChars >= 0 || next.deltaChars <= 0) continue;
      const restoredChars = Math.min(Math.abs(current.deltaChars), next.deltaChars);
      if (restoredChars >= 1 && next.atMs - current.atMs <= 120) {
        perfectCorrectionCount += 1;
      }
    }

    if (perfectCorrectionCount >= 3) {
      flags.add("perfect_corrections");
    }
  }

  for (let index = 1; index < inputEvents.length; index += 1) {
    const previous = inputEvents[index - 1]!;
    const current = inputEvents[index]!;
    if (current.wpm - previous.wpm >= 55) {
      flags.add("sudden_wpm_spike");
      break;
    }
  }

  return Array.from(flags);
}

function scoreFlags(flags: AntiCheatFlag[]) {
  let score = 0;
  for (const flag of flags) {
    if (flag === "impossible_sustained_speed") score += 0.4;
    if (flag === "perfect_corrections") score += 0.2;
    if (flag === "extremely_low_timing_variance") score += 0.4;
    if (flag === "sudden_wpm_spike") score += 0.25;
  }
  return Math.min(1, score);
}

function applyEma(previousScore: number | null, nextScore: number) {
  if (previousScore == null) return nextScore;
  return previousScore * (1 - EMA_ALPHA) + nextScore * EMA_ALPHA;
}

export async function assessMatch(
  matchId: string,
  userId: string,
  inputEvents: AntiCheatInputEvent[],
  options?: { isBot?: boolean; redis?: RedisLike | null }
) {
  if (options?.isBot) {
    return { confidence: 0, flags: [] as AntiCheatFlag[] };
  }

  const flags = buildFlags(inputEvents);
  const rawScore = scoreFlags(flags);
  const redis = options?.redis ?? null;

  const [userScore, matchScore] = await Promise.all([
    readJsonValue<PersistedAnomalyScore>(redis, `pvp:anti-cheat:v2:user:${userId}`),
    readJsonValue<PersistedAnomalyScore>(redis, `pvp:anti-cheat:v2:match:${matchId}:user:${userId}`),
  ]);

  const nextUserScore = applyEma(userScore?.emaScore ?? null, rawScore);
  const nextMatchScore = applyEma(matchScore?.emaScore ?? null, rawScore);
  const confidence = Math.min(1, Math.max(rawScore, nextUserScore, nextMatchScore));

  const persisted: PersistedAnomalyScore = {
    emaScore: confidence,
    flags,
    updatedAt: Date.now(),
  };

  await Promise.all([
    writeJsonValue(redis, `pvp:anti-cheat:v2:user:${userId}`, persisted, ANTI_CHEAT_TTL_SECONDS),
    writeJsonValue(redis, `pvp:anti-cheat:v2:match:${matchId}:user:${userId}`, persisted, ANTI_CHEAT_TTL_SECONDS),
  ]);

  return { confidence, flags };
}