"use client";

import { getRankMeta, getPvpRankIconConfig, type PvpRankName } from "./rank-meta";
import { RankTierIcon } from "./RankTierIcon";

export interface RankBadgeProps {
  tier?: string;
  iconSize?: number;
  variant?: "default" | "danger";
}

export function RankBadge({
  tier,
  iconSize,
  variant = "default",
}: RankBadgeProps) {
  const m = getRankMeta(tier);
  const icon = getPvpRankIconConfig((tier ?? "Prime") as PvpRankName, "badge");

  const color = variant === "danger" ? "#F87171" : m.color;
  const bg = variant === "danger" ? "rgba(248, 113, 113, 0.08)" : m.bg;
  const border = variant === "danger" ? "rgba(248, 113, 113, 0.26)" : m.border;
  const glow = variant === "danger" ? "rgba(248, 113, 113, 0.38)" : m.glow;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm"
      style={{
        color,
        background: bg,
        border: `1px solid ${border}`,
        textShadow: `0 0 6px ${glow}`,
      }}
    >
      <RankTierIcon
        src={icon.iconSrc}
        alt={`${tier ?? "Prime"} rank`}
        size={iconSize ?? icon.iconSize}
        color={variant === "danger" ? color : icon.iconColor}
        className="object-contain shrink-0"
      />
      {(tier ?? "Prime").toUpperCase()}
    </span>
  );
}
