"use client";

import type { CSSProperties } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { StreakFlame } from "./StreakFlame";
import { getRankMeta } from "./rank-meta";

export interface PvpAvatarProps {
  username: string;
  avatarUrl?: string | null;
  size: number;
  accentColor?: string;
  glowColor?: string;
  rankTier?: string;
  level?: number;
  streak?: number;
  levelColor?: string;
  className?: string;
  style?: CSSProperties;
}

export function PvpAvatar({
  username,
  avatarUrl,
  size,
  accentColor,
  glowColor,
  rankTier,
  level = 1,
  streak,
  levelColor,
  className,
  style,
}: PvpAvatarProps) {
  const rankMeta = getRankMeta(rankTier);
  const lvlColor = levelColor ?? rankMeta.color;
  const resolvedAccent = accentColor ?? rankMeta.color;
  const resolvedGlow = glowColor ?? rankMeta.glow;

  return (
    <div className="relative">
      <UserAvatar
        decorative
        username={username}
        avatarUrl={avatarUrl}
        fallbackCharacterCount={1}
        loading="eager"
        className={`relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-black transition-all duration-300 ${className ?? ""}`}
        fallbackClassName="font-black"
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.38),
          letterSpacing: "-0.02em",
          color: resolvedAccent,
          background: "rgba(6,12,24,0.92)",
          border: `2px solid ${resolvedAccent}60`,
          boxShadow: `0 0 18px ${resolvedGlow}, inset 0 0 10px rgba(0,0,0,0.5)`,
          ...style,
        }}
      />

      {/* Streak indicator */}
      {streak !== undefined && streak > 2 && (
        <div className="absolute -bottom-0.5 -right-0.5">
          <div
            className="flex h-5 w-5 items-center justify-center rounded-full backdrop-blur-sm"
            style={{
              background: `radial-gradient(circle, rgba(255,80,80,0.5) 0%, rgba(255,80,80,0) 80%)`,
              boxShadow: `0 0 8px rgba(255,80,80,0.6)`,
            }}
          >
            <StreakFlame streak={streak} size={10} />
          </div>
        </div>
      )}

      {/* Level badge */}
      <div
        className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[8px] font-bold leading-none tracking-tight backdrop-blur-md"
        style={{
          background: `linear-gradient(135deg, ${lvlColor}20, rgba(0,0,0,0.7))`,
          border: `1px solid ${lvlColor}60`,
          color: lvlColor,
          textShadow: `0 0 4px ${lvlColor}99`,
        }}
      >
        Lv.{level}
      </div>
    </div>
  );
}
