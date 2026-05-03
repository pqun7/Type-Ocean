"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const designTokens = {
  glass: {
    base: "bg-black/30 backdrop-blur-2xl",
    border: "border-white/10",
    hoverBorder: "hover:border-white/20",
    shadow: "shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)]",
    tactile:
      "shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_12px_24px_-12px_rgba(0,0,0,0.8)]",
  },
};

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: "cyan" | "purple" | "amber";
  depth?: "default" | "elevated";
}

export const GlassCard = ({
  children,
  className = "",
  glowColor = "cyan",
  depth = "default",
}: GlassCardProps) => {
  const glowMap = {
    cyan: "from-cyan-500/5 via-cyan-400/5 to-transparent",
    purple: "from-purple-500/5 via-purple-400/5 to-transparent",
    amber: "from-amber-500/5 via-amber-400/5 to-transparent",
  };

  const depthClass =
    depth === "elevated"
      ? "shadow-[0_20px_40px_-12px_rgba(0,0,0,0.4),0_8px_20px_-8px_rgba(0,0,0,0.3)]"
      : "shadow-[0_12px_24px_-8px_rgba(0,0,0,0.3),0_4px_12px_-4px_rgba(0,0,0,0.2)]";

  return (
    <div
      className={cn(
        "group relative rounded-3xl border border-white/[0.06] bg-black/15 backdrop-blur-md transition-all duration-700 ease-out hover:border-white/[0.12]",
        depthClass,
        className
      )}
    >
      {/* Decorative layers contained inside */}
      <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
        <div
          className={cn(
            "absolute inset-0 z-0 bg-gradient-to-r opacity-0 blur-2xl transition-opacity duration-1000 group-hover:opacity-100",
            glowMap[glowColor]
          )}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
};
