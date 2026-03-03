import {
  Shield,
  Medal,
  Trophy,
  Gem,
  Diamond,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { RankTier } from "@/features/ranking/rating";
import type { PvpRankTier } from "@/features/pvp/rank";

export const RANK_ICON_BY_TIER: Record<RankTier, LucideIcon> = {
  Prime: Shield,
  Silver: Medal,
  Gold: Trophy,
  Platinum: Gem,
  Diamond,
  Legendary: Sparkles,
};

export const RANK_IMAGE_BY_TIER: Record<RankTier, string> = {
  Prime:     "/icons/Prime.png",
  Silver:    "/icons/Silver.png",
  Gold:      "/icons/Gold.png",
  Platinum:  "/icons/Platinum.png",
  Diamond:   "/icons/Diamond.png",
  Legendary: "/icons/Legendary.png",
};

export function getRankIconForTier(tier: RankTier | PvpRankTier): LucideIcon {
  return RANK_ICON_BY_TIER[tier as RankTier] ?? Shield;
}

export function getRankImageSrc(tier: RankTier | PvpRankTier): string {
  return RANK_IMAGE_BY_TIER[tier as RankTier] ?? "/icons/Prime.png";
}
