export function computeWeightedPerSessionConsistency(history: Array<Array<{ wpm?: number }>>): number {
  if (!Array.isArray(history) || history.length === 0) return 0;

  let weightedVarianceSum = 0;
  let totalPoints = 0;

  for (const session of history) {
    if (!Array.isArray(session) || session.length === 0) continue;
    const points = session
      .map((p) => (typeof p?.wpm === "number" ? p.wpm : NaN))
      .filter(Number.isFinite);
    const n = points.length;
    if (n <= 1) continue; // need at least 2 points for variance
    const mean = points.reduce((s, v) => s + v, 0) / n;
    const variance = points.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
    weightedVarianceSum += variance * n;
    totalPoints += n;
  }

  if (totalPoints === 0) return 0;
  const pooledVariance = weightedVarianceSum / totalPoints;
  const result = Math.sqrt(pooledVariance);
  return Number.isFinite(result) ? result : 0;
}
