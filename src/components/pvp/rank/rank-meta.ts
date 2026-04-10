import {
  getPvpRankImageAsset,
  type RankImageVariant,
} from "@/features/ranking/rank-visuals";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PvpRankIconVariant = Extract<RankImageVariant, "flat" | "flat-no-color">;

export const PVP_RANKS = [
  "Prime",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Legendary",
] as const;

export type PvpRankName = (typeof PVP_RANKS)[number];
export type PvpRankIconSlot = "badge" | "progression";

export type PvpRankIconOverride = {
  variant?: PvpRankIconVariant;
  size?: number;
  color?: string;
};

export type RankMetaEntry = {
  color: string;
  glow: string;
  border: string;
  bg: string;
  minRating: number;
  maxRating: number;
  xpNeeded: number;
};

// ─── Rank Meta Data ────────────────────────────────────────────────────────────
// Boundaries match rank.ts TIERS exactly:
// Prime [0,850), Silver [850,1150), Gold [1150,1500),
// Platinum [1500,1850), Diamond [1850,2200), Legendary [2200,∞)

export const RANK_META: Record<string, RankMetaEntry> = {
  Prime: {
    color: "#60A5FA",
    glow: "rgba(96,165,250,0.38)",
    border: "rgba(96,165,250,0.26)",
    bg: "rgba(96,165,250,0.08)",
    minRating: 0,
    maxRating: 849,
    xpNeeded: 850,
  },
  Silver: {
    color: "#94A3B8",
    glow: "rgba(148,163,184,0.38)",
    border: "rgba(148,163,184,0.26)",
    bg: "rgba(148,163,184,0.08)",
    minRating: 850,
    maxRating: 1149,
    xpNeeded: 300,
  },
  Gold: {
    color: "#F59E0B",
    glow: "rgba(245,158,11,0.38)",
    border: "rgba(245,158,11,0.26)",
    bg: "rgba(245,158,11,0.08)",
    minRating: 1150,
    maxRating: 1499,
    xpNeeded: 350,
  },
  Platinum: {
    color: "#22D3EE",
    glow: "rgba(34,211,238,0.38)",
    border: "rgba(34,211,238,0.26)",
    bg: "rgba(34,211,238,0.08)",
    minRating: 1500,
    maxRating: 1849,
    xpNeeded: 350,
  },
  Diamond: {
    color: "#818CF8",
    glow: "rgba(129,140,248,0.38)",
    border: "rgba(129,140,248,0.26)",
    bg: "rgba(129,140,248,0.08)",
    minRating: 1850,
    maxRating: 2199,
    xpNeeded: 350,
  },
  Legendary: {
    color: "#F472B6",
    glow: "rgba(244,114,182,0.38)",
    border: "rgba(244,114,182,0.26)",
    bg: "rgba(244,114,182,0.08)",
    minRating: 2200,
    maxRating: 9999,
    xpNeeded: 0,
  },
};

// ─── Icon Config ───────────────────────────────────────────────────────────────

export const PVP_RANK_ICON_DEFAULTS: Record<
  PvpRankIconSlot,
  { variant: PvpRankIconVariant; size: number }
> = {
  badge: { variant: "flat", size: 14 },
  progression: { variant: "flat", size: 20 },
};

export const PVP_RANK_ICON_OVERRIDES: Record<
  PvpRankIconSlot,
  Partial<Record<PvpRankName, PvpRankIconOverride>>
> = {
  badge: {
    Prime: { variant: "flat-no-color", size: 14 },
    Silver: { variant: "flat-no-color", size: 14 },
    Gold: { variant: "flat-no-color", size: 14 },
    Platinum: { variant: "flat-no-color", size: 14 },
    Diamond: { variant: "flat-no-color", size: 14 },
    Legendary: { variant: "flat-no-color", size: 14 },
  },
  progression: {
    Prime: { variant: "flat", size: 22 },
    Silver: { variant: "flat", size: 22 },
    Gold: { variant: "flat", size: 23 },
    Platinum: { variant: "flat", size: 24 },
    Diamond: { variant: "flat", size: 25 },
    Legendary: { variant: "flat", size: 27 },
  },
};

// ─── Utility Functions ─────────────────────────────────────────────────────────

export function getRankMeta(tier?: string): RankMetaEntry {
  return tier ? (RANK_META[tier] ?? RANK_META.Prime) : RANK_META.Prime;
}

export function getRankProgress(
  rating: number = 0,
  tier?: string,
): { current: number; max: number; percentage: number; nextRank: string } {
  const currentMeta = getRankMeta(tier);
  if (tier === "Legendary")
    return { current: rating, max: rating, percentage: 100, nextRank: "Legendary" };

  const nextRankKey = Object.keys(RANK_META).find(
    (key) => RANK_META[key].minRating === currentMeta.maxRating + 1,
  );
  const nextRank = nextRankKey ?? "Legendary";
  const maxXp = currentMeta.xpNeeded;
  const currentXp = rating - currentMeta.minRating;
  const percentage = Math.min(100, Math.max(0, (currentXp / maxXp) * 100));

  return { current: currentXp, max: maxXp, percentage, nextRank };
}

/** Resolves the full icon config for a given rank + slot. Used by RankBadge and RankProgression. */
export function getPvpRankIconConfig(rank: PvpRankName, slot: PvpRankIconSlot) {
  const defaults = PVP_RANK_ICON_DEFAULTS[slot];
  const overrides = PVP_RANK_ICON_OVERRIDES[slot][rank];
  const variant = overrides?.variant ?? defaults.variant;
  const asset = getPvpRankImageAsset(rank, variant);

  return {
    iconSrc: asset.iconSrc,
    iconColor: overrides?.color ?? asset.iconColor,
    iconSize: overrides?.size ?? defaults.size,
    variant,
  };
}
