export type DailyActivityStrengthInput = {
  totalMinutes: number;
  sessionsCount: number;
  avgWpm: number;
  avgAccuracy: number;
};

export type DailyActivityStrengthOutput = {
  rawScore: number;
  strength01: number;
  strength100: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeFinite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Compute a normalized per-day activity strength score.
 *
 * Goals:
 * - Stable scale across time (0-100)
 * - Highlights small activity differences (log normalization)
 * - Blends volume (minutes, sessions) with quality (WPM/accuracy)
 */
export function computeDailyActivityStrength(
  input: DailyActivityStrengthInput
): DailyActivityStrengthOutput {
  const totalMinutes = Math.max(0, safeFinite(input.totalMinutes, 0));
  const sessionsCount = Math.max(0, Math.floor(safeFinite(input.sessionsCount, 0)));
  const avgWpm = Math.max(0, safeFinite(input.avgWpm, 0));
  const avgAccuracy = clamp(safeFinite(input.avgAccuracy, 0), 0, 100);

  // Quality: blend speed + accuracy in a stable 0..1 range.
  const wpm01 = clamp(avgWpm / 120, 0, 1);
  const acc01 = clamp(avgAccuracy / 100, 0, 1);
  const quality01 = 0.6 * wpm01 + 0.4 * acc01;

  // Volume: minutes dominate; sessions add smaller signal.
  // The quality factor slightly boosts minutes so higher-quality practice "counts" more.
  const sessionWeight = 0.25; // minutes-equivalent per session (small signal)
  const minutesFactor = 0.7 + 0.3 * quality01;

  const rawScore = totalMinutes * minutesFactor + sessionsCount * sessionWeight;

  // Reference target: a strong day (60m + 6 sessions) at good quality.
  // Fixed reference keeps the scale stable across users and years.
  const referenceQuality01 = 0.85;
  const referenceRaw = 60 * (0.7 + 0.3 * referenceQuality01) + 6 * sessionWeight;

  const denom = Math.log1p(referenceRaw);
  const volume01 = denom <= 0 ? 0 : clamp(Math.log1p(rawScore) / denom, 0, 1);

  // Penalize very short days so a bunch of tiny sessions don't light up the heatmap too much.
  // Use minutes as the main gate (time spent matters most for activity strength).
  const minutesRef = 20;
  const minutesPenalty = clamp(Math.sqrt(totalMinutes / minutesRef), 0, 1);
  const strength01 = clamp(volume01 * minutesPenalty, 0, 1);
  const strength100 = Number((strength01 * 100).toFixed(2));

  return {
    rawScore: Number(rawScore.toFixed(4)),
    strength01: Number(strength01.toFixed(4)),
    strength100,
  };
}
