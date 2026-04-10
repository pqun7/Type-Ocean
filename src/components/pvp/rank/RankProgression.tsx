"use client";

import { useMemo } from "react";
import { RANK_META, PVP_RANKS, getPvpRankIconConfig } from "./rank-meta";
import { RankTierIcon } from "./RankTierIcon";

export interface RankProgressionProps {
  currentTier?: string;
  rating?: number;
  streak?: number;
  iconSize?: number;
}

export function RankProgression({
  currentTier,
  rating = 0,
  iconSize,
}: RankProgressionProps) {
  const ranks = PVP_RANKS;
  const currentIndex = ranks.findIndex((r) => r === currentTier);
  const currentRankMeta = RANK_META[currentTier ?? "Prime"];

  const overallProgress = useMemo(() => {
    if (!currentTier) return 0;
    if (currentTier === "Legendary") return 1;

    const currentMin = currentRankMeta.minRating;
    const currentMax = currentRankMeta.maxRating;
    const range = currentMax - currentMin;
    const progressInRank = range > 0 ? (rating - currentMin) / range : 0;
    const clampedProgress = Math.min(1, Math.max(0, progressInRank));

    return (currentIndex + clampedProgress) / (ranks.length - 1);
  }, [currentTier, rating, currentRankMeta, currentIndex, ranks.length]);

  const premiumGradient = useMemo(
    () => "linear-gradient(90deg, #3B82F6, #A855F7)",
    [],
  );

  return (
    <div className="relative w-full py-2">
      {/* Icons row */}
      <div className="grid grid-cols-6 gap-0 mb-2">
        {ranks.map((rank, idx) => {
          const meta = RANK_META[rank];
          const icon = getPvpRankIconConfig(rank, "progression");
          const isActive = idx <= currentIndex;
          const isCurrent = rank === currentTier;

          return (
            <div key={`icon-${rank}`} className="flex justify-center items-center">
              <div
                className={`transition-all duration-300 ${isCurrent ? "scale-110" : "scale-100"}`}
                style={{
                  opacity: isActive ? 1 : 0.35,
                  filter: isCurrent ? `drop-shadow(0 0 8px ${meta.glow})` : "none",
                }}
              >
                <RankTierIcon
                  src={icon.iconSrc}
                  alt={`${rank} rank`}
                  size={iconSize ?? icon.iconSize}
                  color={icon.iconColor}
                  className={`object-contain ${isCurrent ? "animate-pulse" : ""}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress track with dots */}
      <div className="relative grid grid-cols-6 gap-0 mt-1">
        {/* Glass‑morphic background track */}
        <div
          className="absolute left-0 right-0 h-[2px] rounded-full"
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            background: "rgba(255,255,255,0.08)",
            backdropFilter: "blur(2px)",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.2)",
          }}
        />

        {/* Animated fill line with shimmer */}
        <div
          className="absolute left-0 h-[2px] rounded-full overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.34,1.2,0.64,1)]"
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            width: `${overallProgress * 100}%`,
            background: premiumGradient,
            boxShadow: "0 0 6px rgba(59,130,246,0.5)",
          }}
        >
          {/* Shimmer overlay */}
          <div
            className="absolute inset-0 w-full h-full animate-shimmer"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)",
              transform: "skewX(-20deg)",
            }}
          />
        </div>

        {/* Dots / rank nodes */}
        {ranks.map((rank, idx) => {
          const meta = RANK_META[rank];
          const isActive = idx <= currentIndex;
          const isCurrent = rank === currentTier;
          const dotColor = isActive ? meta.color : "rgba(255,255,255,0.2)";

          return (
            <div
              key={`dot-${rank}`}
              className="flex justify-center items-center relative z-10"
              style={{ height: 20 }}
            >
              {isCurrent ? (
                <div className="relative flex items-center justify-center">
                  {/* Outer pulsing ring */}
                  <div
                    className="absolute rounded-full animate-ping-slow"
                    style={{
                      width: 18.4,
                      height: 18.4,
                      backgroundColor: `${meta.color}40`,
                      boxShadow: `0 0 12px rgba(255, 130, 0, 0.75)`,
                      animationDuration: "1.15s",
                    }}
                  />
                  {/* Inner core */}
                  <div
                    className="relative rounded-full transition-all duration-300"
                    style={{
                      width: 8,
                      height: 8,
                      backgroundColor: meta.color,
                      boxShadow: `0 0 12px rgba(255, 130, 0, 0.75)`,
                    }}
                  />
                </div>
              ) : (
                <div
                  className="w-2 h-2 rounded-full transition-all duration-300"
                  style={{
                    backgroundColor: dotColor,
                    boxShadow: isActive ? `0 0 6px ${meta.glow}` : "none",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Rank labels (appear on hover) */}
      <div className="absolute bottom-full left-0 right-0 pointer-events-none opacity-0 hover:opacity-100 transition-opacity duration-300">
        <div className="grid grid-cols-6 gap-0 text-center text-[9px] font-mono">
          {ranks.map((rank) => (
            <div key={rank} className="text-white/40">
              {rank}
            </div>
          ))}
        </div>
      </div>

      {/* Animations */}
      <style jsx>{`
        @keyframes ping-slow {
          0% { transform: scale(0.8); opacity: 0.8; }
          75%, 100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%) skewX(-20deg); }
          100% { transform: translateX(200%) skewX(-20deg); }
        }
        .animate-ping-slow {
          animation: ping-slow 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        .animate-shimmer {
          animation: shimmer 2.5s infinite;
        }
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
