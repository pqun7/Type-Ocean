"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { getRankMeta, getRankProgress } from "./rank-meta";

export interface XPGainDisplayProps {
  rating?: number;
  tier?: string;
}

export function XPGainDisplay({ rating, tier }: XPGainDisplayProps) {
  const [showGain, setShowGain] = useState(false);
  const [gainAmount, setGainAmount] = useState(0);
  const prevRatingRef = useRef(rating);

  useEffect(() => {
    if (
      rating !== undefined &&
      prevRatingRef.current !== undefined &&
      rating !== prevRatingRef.current
    ) {
      const gain = rating - prevRatingRef.current;
      if (gain > 0) {
        setGainAmount(gain);
        setShowGain(true);
        setTimeout(() => setShowGain(false), 2000);
      }
    }
    prevRatingRef.current = rating;
  }, [rating]);

  const progress = getRankProgress(rating, tier);
  const meta = getRankMeta(tier);

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <div
            className="text-[9px] font-bold uppercase tracking-wider"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            XP PROGRESS
          </div>
          {showGain && (
            <div
              className="flex items-center gap-0.5 text-[10px] font-bold animate-bounce"
              style={{ color: "#4ADE80" }}
            >
              <ArrowUp className="h-2.5 w-2.5" />
              +{gainAmount} XP
            </div>
          )}
        </div>
        <div
          className="text-[8px] font-mono"
          style={{ color: "rgba(255,255,255,0.3)" }}
        >
          {progress.current} / {progress.max} XP
        </div>
      </div>
      <div
        className="relative h-1 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${progress.percentage}%`,
            background: `linear-gradient(90deg, ${meta.color}, ${meta.glow})`,
            boxShadow: `0 0 8px ${meta.glow}`,
          }}
        />
      </div>
      <div
        className="flex justify-between mt-1 text-[8px] font-medium"
        style={{ color: "rgba(255,255,255,0.25)" }}
      >
        <span>{tier ?? "Prime"}</span>
        <span>→ {progress.nextRank}</span>
      </div>
    </div>
  );
}
