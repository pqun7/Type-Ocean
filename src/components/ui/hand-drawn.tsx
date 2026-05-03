"use client";

import * as React from "react";

// ============================================================================
// Hand-Drawn Accent Components (Proof of Personhood Aesthetic)
// ============================================================================

const designTokens = {
  handDrawn: {
    filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))",
    stroke: "stroke-white/40 stroke-[1.5] fill-none",
  },
};

export const HandDrawnSquiggle = ({ className = "" }: { className?: string }) => (
  <svg
    className={`pointer-events-none absolute ${className}`}
    width="120"
    height="30"
    viewBox="0 0 120 30"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ filter: designTokens.handDrawn.filter }}
  >
    <path
      d="M5,15 Q20,5 35,15 T65,15 T95,15 T115,12"
      className={designTokens.handDrawn.stroke}
      strokeLinecap="round"
      strokeDasharray="3 2"
    />
  </svg>
);

export const HandDrawnCircle = ({ className = "" }: { className?: string }) => (
  <svg
    className={`pointer-events-none absolute ${className}`}
    width="40"
    height="40"
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ filter: designTokens.handDrawn.filter }}
  >
    <circle
      cx="20"
      cy="20"
      r="16"
      className={designTokens.handDrawn.stroke}
      strokeDasharray="4 3"
    />
  </svg>
);
