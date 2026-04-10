import type { RankTier } from "@/features/ranking/rating";
import type { PvpRankTier } from "@/features/pvp/rank";

export type RankImageVariant = "illustrated" | "flat" | "flat-no-color";

export type RankImageAsset = {
  src: string;
  color?: string;
  variant: RankImageVariant;
};

export type PvpRankImageAsset = {
  iconSrc: string;
  iconColor?: string;
  variant: Extract<RankImageVariant, "flat" | "flat-no-color">;
};

type RankTierLike = RankTier | PvpRankTier;
type PvpRankImageVariant = Extract<RankImageVariant, "flat" | "flat-no-color">;

const FALLBACK_TIER: RankTier = "Prime";

export const RANK_IMAGE_PATHS: Record<RankImageVariant, Record<RankTier, string>> = {
  illustrated: {
    Prime: "/icons/ranks/illustrated/prime.png",
    Silver: "/icons/ranks/illustrated/silver.png",
    Gold: "/icons/ranks/illustrated/gold.png",
    Platinum: "/icons/ranks/illustrated/platinum.png",
    Diamond: "/icons/ranks/illustrated/diamond.png",
    Legendary: "/icons/ranks/illustrated/legendary.png",
  },
  flat: {
    Prime: "/icons/ranks/flat/prime.svg",
    Silver: "/icons/ranks/flat/silver.svg",
    Gold: "/icons/ranks/flat/gold.svg",
    Platinum: "/icons/ranks/flat/platinum.svg",
    Diamond: "/icons/ranks/flat/diamond.svg",
    Legendary: "/icons/ranks/flat/legendary.svg",
  },
  "flat-no-color": {
    Prime: "/icons/ranks/flat-no-color/prime.png",
    Silver: "/icons/ranks/flat-no-color/silver.png",
    Gold: "/icons/ranks/flat-no-color/gold.png",
    Platinum: "/icons/ranks/flat-no-color/platinum.png",
    Diamond: "/icons/ranks/flat-no-color/diamond.png",
    Legendary: "/icons/ranks/flat-no-color/legendary.png",
  },
};

export const RANK_IMAGE_TINT_COLORS: Partial<Record<RankImageVariant, string>> = {
  "flat-no-color": "#60A5FA",
};

function normalizeRankTier(tier: RankTierLike | undefined): RankTier {
  if (!tier) return FALLBACK_TIER;
  return tier in RANK_IMAGE_PATHS.illustrated ? (tier as RankTier) : FALLBACK_TIER;
}

export function getRankImageSrc(
  tier: RankTierLike | undefined,
  variant: RankImageVariant = "illustrated"
): string {
  return RANK_IMAGE_PATHS[variant][normalizeRankTier(tier)];
}

export function getRankImageTintColor(
  variant: RankImageVariant
): string | undefined {
  return RANK_IMAGE_TINT_COLORS[variant];
}

export function getRankImageAsset(
  tier: RankTierLike | undefined,
  variant: RankImageVariant = "illustrated"
): RankImageAsset {
  return {
    src: getRankImageSrc(tier, variant),
    color: getRankImageTintColor(variant),
    variant,
  };
}

export function getPvpRankImageSrc(
  tier: RankTierLike | undefined,
  variant: PvpRankImageVariant = "flat"
): string {
  return getRankImageSrc(tier, variant);
}

export function getPvpRankImageColor(
  variant: PvpRankImageVariant = "flat"
): string | undefined {
  return getRankImageTintColor(variant);
}

export function getPvpRankImageAsset(
  tier: RankTierLike | undefined,
  variant: PvpRankImageVariant = "flat"
): PvpRankImageAsset {
  return {
    iconSrc: getRankImageSrc(tier, variant),
    iconColor: getRankImageTintColor(variant),
    variant,
  };
}
