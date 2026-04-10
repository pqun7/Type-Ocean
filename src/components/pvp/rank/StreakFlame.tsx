"use client";

import React, { useEffect, useRef, useState } from "react";
import { Flame } from "lucide-react";

export interface StreakFlameProps {
  streak: number;
  size?: number;
  className?: string;
}

export const StreakFlame: React.FC<StreakFlameProps> = ({
  streak,
  size = 12,
  className = "",
}) => {
  const prevStreakRef = useRef(streak);
  const [burst, setBurst] = useState(false);

  // Intensity factor: 0 at streak=3, 1 at streak=25 (caps at 1)
  const intensity = Math.min(1, Math.max(0, (streak - 3) / 22));

  // Visual parameters – dynamic and premium
  const scale = 0.85 + intensity * 0.55;   // 0.85 → 1.4
  const opacity = 0.65 + intensity * 0.35; // 0.65 → 1.0
  const coreGlowBlur = intensity * 8;      // 0 → 8px
  const outerGlowBlur = intensity * 12;    // 0 → 12px

  // Heat‑based color: orange (20°) → deep red (0°)
  const hue = 20 - intensity * 20;
  const saturation = 100;
  const lightness = 60 + intensity * 15; // 60% → 75% brighter

  // Burst animation on streak increase (subtle scale & glow pop)
  useEffect(() => {
    if (streak > prevStreakRef.current && streak > 2) {
      setBurst(true);
      const timer = setTimeout(() => setBurst(false), 400);
      return () => clearTimeout(timer);
    }
    prevStreakRef.current = streak;
  }, [streak]);

  // No render for streak ≤ 2
  if (streak <= 2) return null;

  return (
    <div
      className={`inline-block ${className}`}
      style={{
        transform: burst ? "scale(1.45)" : "scale(1)",
        transition: burst
          ? "transform 0.25s cubic-bezier(0.34, 1.2, 0.64, 1)"
          : "none",
        filter: burst
          ? `drop-shadow(0 0 14px hsla(${hue}, 100%, 55%, 0.9))`
          : `drop-shadow(0 0 ${outerGlowBlur}px hsla(${hue}, ${saturation}%, 55%, ${0.5 + intensity * 0.5}))`,
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          filter: `drop-shadow(0 0 ${coreGlowBlur}px hsla(${hue}, ${saturation}%, 55%, ${0.7 + intensity * 0.3}))`,
        }}
      >
        <Flame
          size={size}
          style={{
            color: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
            opacity,
            transition: "color 0.2s ease, opacity 0.2s ease",
          }}
        />
      </div>
      {/* Outer glow aura (intensity‑scaled) – creates heat haze effect */}
      {intensity > 0.2 && (
        <div
          className="absolute inset-0 -z-10 rounded-full blur-md"
          style={{
            background: `radial-gradient(circle, hsla(${hue}, ${saturation}%, 55%, ${0.3 + intensity * 0.4}) 0%, transparent 70%)`,
            transform: `scale(${1 + intensity * 0.5})`,
          }}
        />
      )}
    </div>
  );
};
