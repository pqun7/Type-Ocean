export type PvpRankTier =
  | "Prime"
  | "Silver"
  | "Gold"
  | "Platinum"
  | "Diamond"
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
  { tier: "Prime",     min: 0,    max: 850  },
  { tier: "Silver",    min: 850,  max: 1150 },
  { tier: "Gold",      min: 1150, max: 1500 },
  { tier: "Platinum",  min: 1500, max: 1850 },
  { tier: "Diamond",   min: 1850, max: 2200 },
  { tier: "Legendary", min: 2200, max: null },
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
