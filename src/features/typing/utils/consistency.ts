/**
 * Computes the WPM consistency as a percentage (0-100).
 *
 * Higher values indicate better consistency (less fluctuation in speed).
 *
 * Calculation steps:
 * 1. Collect all valid raw WPM points from every session (flattening the history).
 * 2. Compute the sample standard deviation (unbiased, divide by n-1).
 * 3. Compute the coefficient of variation (CV = stdDev / mean).
 * 4. Consistency % = 100 - (CV × 100) → inverted CV scaled to percentage.
 * 5. Clamp between 0 and 100 for safety.
 * 
 * This formula is:
 * - Statistically sound and widely used in typing platforms.
 * - Closely aligned with Monkeytype's approach (uses coefficient of variation of raw WPM,
 *   mapped to 0-100%, where higher is better).
 * - Simple, performant, and fully defensive (no NaN, handles edge cases gracefully).
 * 
 * Requires at least 2 valid data points.
 *
 * Returns `null` when there is insufficient data to produce a meaningful
 * consistency value.
 * 
 * @param history - Array of sessions, each containing points with optional `wpm` (raw/rolling WPM).
 * @returns Consistency percentage (0-100) or `null` if insufficient data.
 */
export function computeConsistency(
  history: Array<Array<{ wpm?: number }>>
): number | null {
  if (!Array.isArray(history) || history.length === 0) return null;

  // Flatten and collect all valid finite WPM values
  const validPoints: number[] = [];

  for (const session of history) {
    if (!Array.isArray(session)) continue;

    for (const point of session) {
      const wpm = point?.wpm;
      if (typeof wpm === "number" && Number.isFinite(wpm) && wpm >= 0) { // اضطرت إضافة wpm >= 0 لتجنب قيم سلبية غير منطقية
        validPoints.push(wpm);
      }
    }
  }

  const n = validPoints.length;

  // Insufficient data → no meaningful consistency
  if (n < 2) return null;

  // Compute mean
  const mean = validPoints.reduce((sum, v) => sum + v, 0) / n;

  // Avoid division by zero (extremely rare, but defensive)
  if (mean === 0) return null;

  // Compute unbiased sample variance
  const variance =
    validPoints.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);

  // Standard deviation
  const stdDev = Math.sqrt(variance);

  // Coefficient of variation (relative variability)
  const cv = stdDev / mean;

  // Consistency percentage: inverted CV, scaled to 0-100%
  let percentage = 100 - (cv * 100);

  // Clamp to valid range and round to 2 decimal places
  percentage = Math.max(0, Math.min(100, percentage));

  return Number(percentage.toFixed(2));
}