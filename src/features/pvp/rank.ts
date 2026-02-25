export type PvpRankTier =
  | "Bronze"
  | "Silver"
  | "Gold"
  | "Platinum"
  | "Diamond"
  | "Master"
  | "Grandmaster";

export type PvpRankDivision = "III" | "II" | "I";

export type PvpRankInfo = {
  rating: number;
  tier: PvpRankTier;
  division: PvpRankDivision;
  progressPct: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const TIERS: Array<{ tier: PvpRankTier; min: number; max: number | null }> = [
  { tier: "Bronze", min: 0, max: 1200 },
  { tier: "Silver", min: 1200, max: 1400 },
  { tier: "Gold", min: 1400, max: 1600 },
  { tier: "Platinum", min: 1600, max: 1800 },
  { tier: "Diamond", min: 1800, max: 2000 },
  { tier: "Master", min: 2000, max: 2200 },
  { tier: "Grandmaster", min: 2200, max: null },
];

export function getPvpRankInfo(ratingInput: number): PvpRankInfo {
  const rating = clamp(Math.round(Number.isFinite(ratingInput) ? ratingInput : 1500), 0, 3000);

  const row = TIERS.find((t) => rating >= t.min && (t.max === null || rating < t.max)) ?? TIERS[0];
  if (row.max === null) {
    return { rating, tier: row.tier, division: "I", progressPct: 100 };
  }

  const tierRange = Math.max(1, row.max - row.min);
  const divisionSize = Math.max(1, Math.floor(tierRange / 3));

  const offset = clamp(rating - row.min, 0, tierRange - 1);
  const idx = clamp(Math.floor(offset / divisionSize), 0, 2);
  const division: PvpRankDivision = idx === 0 ? "III" : idx === 1 ? "II" : "I";

  const divMin = row.min + idx * divisionSize;
  const divMax = idx === 2 ? row.max : row.min + (idx + 1) * divisionSize;
  const progressPct = clamp(((rating - divMin) / Math.max(1, divMax - divMin)) * 100, 0, 100);

  return { rating, tier: row.tier, division, progressPct };
}
