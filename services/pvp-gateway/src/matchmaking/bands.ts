export type MatchmakingPreference = {
  mode: string;
  textDifficulty: string;
};

export type QueueBandConfig = {
  initialRange: number;
  expansionStep: number;
  expansionIntervalMs: number;
  maxRange: number;
};

export const DEFAULT_MATCHMAKING_PREFERENCE: MatchmakingPreference = {
  mode: "ranked_1v1",
  textDifficulty: "normal",
};

export const DEFAULT_QUEUE_BAND_CONFIG: QueueBandConfig = {
  // Progressive search expansion:
  //   0–30 s  → ±50  (initial range)
  //  30–60 s  → ±125 (+75)
  //  60–90 s  → ±200 (+75)
  //  90–120 s → ±275 (+75) — bot fallback fires within this window
  initialRange: 50,
  expansionStep: 75,
  expansionIntervalMs: 30_000,
  maxRange: 300,
};

export function normalizeMatchmakingPreference(
  preference?: Partial<MatchmakingPreference> | null
): MatchmakingPreference {
  const mode = preference?.mode?.trim().toLowerCase();
  const textDifficulty = preference?.textDifficulty?.trim().toLowerCase();

  return {
    mode: mode || DEFAULT_MATCHMAKING_PREFERENCE.mode,
    textDifficulty: textDifficulty || DEFAULT_MATCHMAKING_PREFERENCE.textDifficulty,
  };
}

export function areMatchmakingPreferencesCompatible(
  left?: Partial<MatchmakingPreference> | null,
  right?: Partial<MatchmakingPreference> | null
) {
  const normalizedLeft = normalizeMatchmakingPreference(left);
  const normalizedRight = normalizeMatchmakingPreference(right);

  return normalizedLeft.mode === normalizedRight.mode;
}

export function getExpandedQueueRatingRange(
  waitMs: number,
  config: QueueBandConfig = DEFAULT_QUEUE_BAND_CONFIG
) {
  const safeWaitMs = Math.max(0, waitMs);
  const steps = Math.floor(safeWaitMs / Math.max(1, config.expansionIntervalMs));
  const expanded = config.initialRange + steps * config.expansionStep;
  return Math.min(config.maxRange, expanded);
}

export function canUsersMatchByRating(params: {
  myRating: number;
  otherRating: number;
  myJoinedAtMs: number;
  otherJoinedAtMs: number;
  nowMs: number;
  config?: QueueBandConfig;
}) {
  const config = params.config ?? DEFAULT_QUEUE_BAND_CONFIG;
  const myRange = getExpandedQueueRatingRange(params.nowMs - params.myJoinedAtMs, config);
  const otherRange = getExpandedQueueRatingRange(params.nowMs - params.otherJoinedAtMs, config);
  return Math.abs(params.myRating - params.otherRating) <= Math.max(myRange, otherRange);
}

export function buildQueueBucketKey(baseKey: string, preference?: Partial<MatchmakingPreference> | null) {
  const normalized = normalizeMatchmakingPreference(preference);
  return `${baseKey}:${normalized.mode}`;
}