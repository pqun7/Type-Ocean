// ─── Data & Utilities ─────────────────────────────────────────────────────────
export {
  RANK_META,
  PVP_RANKS,
  PVP_RANK_ICON_DEFAULTS,
  PVP_RANK_ICON_OVERRIDES,
  getRankMeta,
  getRankProgress,
  getPvpRankIconConfig,
} from "./rank-meta";
export type {
  PvpRankIconVariant,
  PvpRankName,
  PvpRankIconSlot,
  PvpRankIconOverride,
  RankMetaEntry,
} from "./rank-meta";

// ─── Components ───────────────────────────────────────────────────────────────
export { RankBadge } from "./RankBadge";
export type { RankBadgeProps } from "./RankBadge";

export { RankProgression } from "./RankProgression";
export type { RankProgressionProps } from "./RankProgression";

export { XPGainDisplay } from "./XPGainDisplay";
export type { XPGainDisplayProps } from "./XPGainDisplay";

export { PvpAvatar } from "./PvpAvatar";
export type { PvpAvatarProps } from "./PvpAvatar";

export { StreakFlame } from "./StreakFlame";
export type { StreakFlameProps } from "./StreakFlame";

export { RankTierIcon } from "./RankTierIcon";
