// في ملف timeUtils.ts
export function getLocalMidnightTTL(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.floor((midnight.getTime() - now.getTime()) / 1000);
}

export const getTodayDate = () => new Date().toISOString().split("T")[0];
