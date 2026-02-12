// في ملف timeUtils.ts
export function getLocalMidnightTTL(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.floor((midnight.getTime() - now.getTime()) / 1000);
}

// Seconds until the next UTC day boundary.
// This matches `new Date().toISOString().split("T")[0]` date semantics.
export function getUtcMidnightTTL(): number {
  const now = new Date();
  const nextUtcMidnight = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0
    )
  );
  return Math.max(0, Math.floor((nextUtcMidnight.getTime() - now.getTime()) / 1000));
}

export const getTodayDate = () => new Date().toISOString().split("T")[0];
