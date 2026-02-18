$ErrorActionPreference = 'Stop'

$content = @'
/**
 * Computes the WPM consistency as a percentage (0-100).
 *
 * Higher values indicate better consistency (less fluctuation in speed).
 *
 * Steps:
 * 1) Flatten all valid WPM points across all sessions.
 * 2) Compute sample standard deviation (divide by n-1).
 * 3) Compute coefficient of variation (CV = stdDev / mean).
 * 4) Consistency = 100 - (CV * 100).
 * 5) Clamp to [0, 100] and round to 2 decimals.
 *
 * Requires at least 2 valid points. Returns 0 if insufficient data.
 */
export function computeConsistency(history: Array<Array<{ wpm?: number }>>): number {
  if (!Array.isArray(history) || history.length === 0) return 0;

  const validPoints: number[] = [];

  for (const session of history) {
    if (!Array.isArray(session)) continue;

    for (const point of session) {
      const wpm = point?.wpm;
      if (typeof wpm !== "number") continue;
      if (!Number.isFinite(wpm)) continue;
      if (wpm < 0) continue;
      validPoints.push(wpm);
    }
  }

  const n = validPoints.length;
  if (n < 2) return 0;

  const mean = validPoints.reduce((sum, v) => sum + v, 0) / n;
  if (mean === 0) return 0;

  const variance =
    validPoints.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  const cv = stdDev / mean;
  let percentage = 100 - cv * 100;

  percentage = Math.max(0, Math.min(100, percentage));
  return Number(percentage.toFixed(2));
}
'@

Set-Content -Path "src/features/typing/utils/consistency.ts" -Value $content -Encoding utf8
Write-Host "Rewrote src/features/typing/utils/consistency.ts" -ForegroundColor Green
