"use client";
/**
 * ⚠️  DEV-ONLY — Achievements Preview Panel
 *
 * Renders a fixed overlay for previewing every achievement card in both
 * locked and unlocked states without completing real sessions.
 *
 * Position: fixed top-right tab (does not conflict with XP test panel at top-center).
 *
 * To remove:
 *   1. Delete this file (src/components/dev/AchievementsTestPanel.tsx)
 *   2. Remove the import + JSX line from UserMenu.tsx  (search: AchievementsTestPanel)
 */

import { useState } from "react";
import {
  Trophy, Lock, Award,
  Zap, Flame, Shield, Star, Swords, Cpu, Activity, Target,
} from "lucide-react";
import { ACHIEVEMENTS } from "@/features/level/constants/level";
import type React from "react";

// ── Tier type + meta ─────────────────────────────────────────────────────────
type AchTier = "common" | "rare" | "epic" | "legendary" | "mythic";

const ACHIEVEMENT_META: Record<string, { icon: React.ReactNode; tier: AchTier }> = {
  velocity:        { icon: <Zap      className="w-4 h-4" />, tier: "common"    },
  consistent_edge: { icon: <Activity className="w-4 h-4" />, tier: "common"    },
  century:         { icon: <Trophy   className="w-4 h-4" />, tier: "common"    },
  speed_demon:     { icon: <Flame    className="w-4 h-4" />, tier: "rare"      },
  perfectionist:   { icon: <Shield   className="w-4 h-4" />, tier: "rare"      },
  velocity_god:    { icon: <Star     className="w-4 h-4" />, tier: "epic"      },
  the_surgeon:     { icon: <Target   className="w-4 h-4" />, tier: "epic"      },
  iron_fingers:    { icon: <Cpu      className="w-4 h-4" />, tier: "legendary" },
  ghost_protocol:  { icon: <Swords   className="w-4 h-4" />, tier: "mythic"    },
};

const TIER_STYLES: Record<AchTier, { border: string; glow: string; icon: string; bg: string; label: string; badge: string }> = {
  common:    { border: "border-cyan-400/25",    glow: "hover:border-cyan-400/55",    icon: "text-cyan-300",    bg: "bg-cyan-400/10",    label: "text-cyan-200",   badge: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"         },
  rare:      { border: "border-violet-400/25",  glow: "hover:border-violet-400/55",  icon: "text-violet-300",  bg: "bg-violet-400/10",  label: "text-violet-200", badge: "border-violet-400/30 bg-violet-400/10 text-violet-300"   },
  epic:      { border: "border-amber-400/25",   glow: "hover:border-amber-400/55",   icon: "text-amber-300",   bg: "bg-amber-400/10",   label: "text-amber-200",  badge: "border-amber-400/30 bg-amber-400/10 text-amber-300"       },
  legendary: { border: "border-rose-400/30",    glow: "hover:border-rose-400/60",    icon: "text-rose-300",    bg: "bg-rose-400/10",    label: "text-rose-200",   badge: "border-rose-400/30 bg-rose-400/10 text-rose-300"           },
  mythic:    { border: "border-fuchsia-500/40", glow: "hover:border-fuchsia-500/70", icon: "text-fuchsia-300", bg: "bg-fuchsia-500/10", label: "text-fuchsia-200", badge: "border-fuchsia-500/35 bg-fuchsia-500/15 text-fuchsia-200" },
};

// ── Short enticing hints shown on cards ─────────────────────────────────────
const ACH_HINT: Record<string, string> = {
  velocity:        "Type at 80 WPM — your fingers are waking up.",
  consistent_edge: "10 sessions holding steady rhythm. Control is power.",
  century:         "100 sessions. You're not playing — you're training.",
  speed_demon:     "100 WPM. You've crossed into real speed territory.",
  perfectionist:   "5 perfect sessions. No excuses, no mistakes.",
  velocity_god:    "120 WPM. Fewer than 1% of typists ever get here.",
  the_surgeon:     "20 sessions at ≥99% accuracy. Ruthlessly precise.",
  iron_fingers:    "100,000 characters typed. Your keyboard felt every one.",
  ghost_protocol:  "5 flawless runs. Perfect. Silent. Unstoppable.",
};
function PreviewCard({
  ach,
  unlocked,
  onClick,
}: {
  ach: (typeof ACHIEVEMENTS)[number];
  unlocked: boolean;
  onClick: () => void;
}) {
  const meta   = ACHIEVEMENT_META[ach.id];
  const tier   = (meta?.tier ?? "common") as AchTier;
  const styles = TIER_STYLES[tier];

  const hasProg = !!(ach.progress && ach.progress.target > 1);
  // Show full progress when unlocked for preview
  const current = unlocked ? (ach.progress?.target ?? 1) : Math.round((ach.progress?.target ?? 1) * 0.45);
  const target  = ach.progress?.target ?? 1;
  const pct     = unlocked ? 100 : Math.min((current / target) * 100, 100);

  const progGrad =
    tier === "mythic"      ? "bg-gradient-to-r from-fuchsia-500 to-purple-400"
    : tier === "legendary" ? "bg-gradient-to-r from-rose-500 to-pink-400"
    : tier === "epic"      ? "bg-gradient-to-r from-amber-500 to-yellow-400"
    : tier === "rare"      ? "bg-gradient-to-r from-violet-500 to-purple-400"
    :                        "bg-gradient-to-r from-cyan-500 to-blue-400";

  const xpColor =
    tier === "mythic"      ? "text-fuchsia-300"
    : tier === "legendary" ? "text-rose-300"
    : tier === "epic"      ? "text-amber-300"
    : tier === "rare"      ? "text-violet-300"
    :                        "text-cyan-300";

  const hint = ACH_HINT[ach.id] ?? ach.description;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Click to toggle\n+${ach.xpReward.toLocaleString()} XP`}
      className={[
        "relative flex flex-col gap-2 rounded-xl border p-3 text-left transition-all duration-200 cursor-pointer",
        unlocked
          ? `${styles.border} ${styles.glow} bg-[rgba(10,15,35,0.65)]`
          : "border-white/6 bg-[rgba(10,15,35,0.3)] opacity-50 grayscale-[35%]",
      ].join(" ")}
    >
      {/* Row 1: Icon + XP */}
      <div className="flex items-center justify-between">
        <div
          className={[
            "flex items-center justify-center w-8 h-8 rounded-lg shrink-0",
            unlocked ? `${styles.bg} ${styles.icon}` : "bg-white/5 text-white/25",
          ].join(" ")}
        >
          {unlocked ? (meta?.icon ?? <Award className="w-4 h-4" />) : <Lock className="w-3.5 h-3.5" />}
        </div>
        <span className={["text-[11px] font-bold font-mono", unlocked ? xpColor : "text-white/18"].join(" ")}>
          +{ach.xpReward.toLocaleString()}
        </span>
      </div>

      {/* Row 2: Name + tier badge */}
      <div className="flex flex-col gap-0.5">
        <p className={["text-[11px] font-bold leading-tight", unlocked ? styles.label : "text-white/30"].join(" ")}>
          {ach.name}
        </p>
        {unlocked && (
          <span className={["self-start text-[7px] font-bold uppercase tracking-widest rounded-full px-1.5 py-0.5 border", styles.badge].join(" ")}>
            {tier}
          </span>
        )}
      </div>

      {/* Row 3: Hint */}
      <p className={["text-[9px] leading-snug line-clamp-2", unlocked ? "text-white/50" : "text-white/22"].join(" ")}>
        {hint}
      </p>

      {/* Progress bar */}
      {hasProg && (
        <div>
          <div className="flex justify-between text-[8px] mb-0.5">
            <span className={unlocked ? "text-white/45" : "text-white/18"}>
              {Math.min(current, target).toLocaleString()}/{target.toLocaleString()}
            </span>
            {unlocked && <span className="text-white/35">{Math.round(pct)}%</span>}
          </div>
          <div className="h-0.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={["h-full rounded-full transition-all duration-500", unlocked ? progGrad : "bg-white/15"].join(" ")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </button>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export const AchievementsTestPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());

  if (process.env.NODE_ENV === "production") return null;

  const toggle = (id: string) =>
    setUnlockedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const unlockAll = () => setUnlockedIds(new Set(ACHIEVEMENTS.map((a) => a.id)));
  const lockAll   = () => setUnlockedIds(new Set());

  const unlockedCount = unlockedIds.size;

  return (
    <div className="fixed top-0 z-[9999] select-none font-mono text-xs flex flex-col items-start" style={{ left: 'calc(50% + 2px)' }}>

      {/* Toggle tab */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        title="Achievements Preview Panel (DEV only)"
        className="flex items-center gap-1.5 rounded-b-xl rounded-tl-none border border-t-0 border-l-0 border-fuchsia-500/40 bg-fuchsia-950/90 px-4 py-1.5 text-white shadow-xl backdrop-blur-sm transition-colors hover:bg-fuchsia-900/90"
      >
        <span className="text-[9px] font-bold tracking-widest text-fuchsia-400 uppercase">DEV</span>
        <span className="text-[11px]">{isOpen ? "✕ Close" : "🏆 Achievements"}</span>
      </button>

      {isOpen && (
        <div className="flex flex-col gap-2 rounded-br-xl border border-t-0 border-l-0 border-fuchsia-500/25 bg-slate-950/97 p-3 shadow-2xl backdrop-blur-md w-[360px] max-h-[85vh] overflow-y-auto">

          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-400">
              Achievement Preview
            </p>
            <span className="text-[9px] text-slate-500">
              {unlockedCount} / {ACHIEVEMENTS.length} unlocked
            </span>
          </div>
          <p className="text-[9px] leading-relaxed text-slate-500 mb-1">
            Click any card to toggle locked ↔ unlocked. Preview matches profile page exactly.
          </p>

          {/* 3×3 grid */}
          <div className="grid grid-cols-3 gap-1.5">
            {ACHIEVEMENTS.map((ach) => (
              <PreviewCard
                key={ach.id}
                ach={ach}
                unlocked={unlockedIds.has(ach.id)}
                onClick={() => toggle(ach.id)}
              />
            ))}
          </div>

          {/* Legend */}
          <div className="mt-1 flex flex-wrap gap-1">
            {(["common", "rare", "epic", "legendary", "mythic"] as AchTier[]).map((tier) => (
              <span
                key={tier}
                className={["text-[7px] font-bold uppercase tracking-widest rounded-full px-1.5 py-0.5 border", TIER_STYLES[tier].badge].join(" ")}
              >
                {tier}
              </span>
            ))}
          </div>

          <hr className="my-1 border-white/10" />

          {/* Bulk actions */}
          <div className="flex gap-1.5">
            <button
              onClick={unlockAll}
              className="flex-1 rounded-lg border border-fuchsia-500/40 bg-fuchsia-900/20 px-2 py-1.5 text-fuchsia-200 transition-colors hover:bg-fuchsia-900/40 text-[10px]"
            >
              🏆 Unlock All
            </button>
            <button
              onClick={lockAll}
              className="flex-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-slate-400 transition-colors hover:bg-white/10 text-[10px]"
            >
              🔒 Lock All
            </button>
          </div>

          <p className="mt-1 rounded border border-yellow-500/20 bg-yellow-950/20 px-2 py-1.5 text-[9px] leading-relaxed text-yellow-500/70">
            To remove: delete this file and the import in UserMenu.tsx
            (search: AchievementsTestPanel)
          </p>
        </div>
      )}
    </div>
  );
};
