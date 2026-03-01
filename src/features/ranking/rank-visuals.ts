import {
  Shield,
  Medal,
  Trophy,
  Gem,
  Diamond,
  Flame,
  Crown,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { RankTier } from "@/features/ranking/rating";
import type { PvpRankTier } from "@/features/pvp/rank";

export const RANK_ICON_BY_TIER: Record<RankTier, LucideIcon> = {
  Shield,
  Silver: Medal,
  Gold: Trophy,
  Platinum: Gem,
  Diamond,
  Apex: Flame,
  Supreme: Crown,
  Legendary: Sparkles,
};

export function getRankIconForTier(tier: RankTier | PvpRankTier): LucideIcon {
  return RANK_ICON_BY_TIER[tier as RankTier] ?? Shield;
}
