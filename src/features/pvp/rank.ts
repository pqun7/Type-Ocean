export type PvpRankTier =
  | "Gold"
  | "Shield"
  | "Silver"
  | "Platinum"
  | "Diamond"
  | "Apex"
  | "Supreme"
  | "Legendary";

export type PvpRankInfo = {
  rating: number;
  tier: PvpRankTier;
  progressPct: number;
  nextAtRating: number | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const TIERS: Array<{ tier: PvpRankTier; min: number; max: number | null }> = [
  // Easy (first 3)
  { tier: "Shield", min: 0, max: 850 },
  { tier: "Silver", min: 850, max: 1150 },
  { tier: "Gold", min: 1150, max: 1400 },
  // Medium (next 2)
  { tier: "Platinum", min: 1400, max: 1750 },
  { tier: "Diamond", min: 1750, max: 2100 },
  // Hard (next 2)
  { tier: "Apex", min: 2100, max: 2400 },
  { tier: "Supreme", min: 2400, max: 2650 },
  // Hardest (last)
  { tier: "Legendary", min: 2650, max: null },
];

export function getPvpRankInfo(ratingInput: number): PvpRankInfo {
  const rating = clamp(Math.round(Number.isFinite(ratingInput) ? ratingInput : 1500), 0, 3000);

  const row = TIERS.find((t) => rating >= t.min && (t.max === null || rating < t.max)) ?? TIERS[0];
  if (row.max === null) {
    return { rating, tier: row.tier, progressPct: 100, nextAtRating: null };
  }

  const tierRange = Math.max(1, row.max - row.min);
  const progressPct = clamp(((rating - row.min) / tierRange) * 100, 0, 100);

  return { rating, tier: row.tier, progressPct, nextAtRating: row.max };
}
