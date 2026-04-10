"use client";
/**
 * ⚠️  DEV-ONLY — XP Notification Test Panel
 *
 * Renders a fixed overlay for previewing every XP notification style without
 * completing a real typing session.
 *
 * To remove:
 *   1. Delete this file (src/components/dev/XPNotificationTestPanel.tsx)
 *   2. Remove the import + JSX line from UserMenu.tsx  (search: XPNotificationTestPanel)
 *
 * This component calls process.env.NODE_ENV at render-time; it returns null in
 * production and is dead-code-eliminated by Next.js in production builds.
 */

import { useState } from "react";
import { useLevel } from "@/features/level/hooks/useLevel";
import type { XPMessageType } from "@/features/level/types/level";

// ── Notification catalogue ───────────────────────────────────────────────────
// Each entry fires addXPMessage() with the given (text, value, type).
// Duplicate entries with different values let you test visual escalation rules.

type PreviewItem = {
  label: string;
  text: string;
  value: number;
  type: XPMessageType;
  note?: string;        // shown as a tooltip / subtitle in the panel
};

const PREVIEW_NOTIFICATIONS: PreviewItem[] = [
  // ── Mythic tier ──
  {
    label: "✦ Flawless Run",
    text: "✦ Flawless Run",
    value: 350,
    type: "mythic",
    note: "0 errors · 0 corrections · 100% acc · ≥85% consistency · ≥85% of target WPM",
  },
  {
    label: "⚡ Speed God (large)",
    text: "⚡ Speed God",
    value: 480,
    type: "mythic",
    note: "Level-scaled WPM floor (78→120 WPM) · 95%+ acc · 78%+ consistency — mutually exclusive with speed bonuses below",
  },
  {
    label: "◆ Eternal Precision",
    text: "◆ Eternal Precision",
    value: 410,
    type: "mythic",
    note: "100% acc · 400–550+ chars · 45s+ · 82%+ consistency — slow but perfect typists",
  },
  {
    label: "★ Perfect Storm (glow ≥300)",
    text: "★ Perfect Storm",
    value: 460,
    type: "mythic",
    note: "Flawless Run conditions (85%+ consist., 90% target WPM) AND a new personal best — suppresses flawless_run + PB",
  },
  {
    label: "★ Perfect Storm (small, no glow)",
    text: "★ Perfect Storm",
    value: 90,
    type: "mythic",
    note: "Low-value mythic pill preview — purple glow only at ≥300 XP",
  },

  // ── Personal Best tier ──
  {
    label: "⚡ Personal Best +15% (bold)",
    text: "⚡ Personal Best",
    value: 195,
    type: "personal-best",
    note: "Beats previous WPM record by >15% — tier 3, up to 280 XP",
  },
  {
    label: "⚡ Personal Best +5–15%",
    text: "⚡ Personal Best",
    value: 140,
    type: "personal-best",
    note: "Beats previous WPM record by 5–15% — tier 2, up to 200 XP",
  },
  {
    label: "⚡ Personal Best <5% (small)",
    text: "⚡ Personal Best",
    value: 80,
    type: "personal-best",
    note: "Beats previous WPM record by <5% — tier 1, up to 140 XP",
  },

  // ── Standard bonuses (dynamic: floor = base, ceiling = base × 1.40) ──
  {
    label: "Steady Hands",
    text: "Steady Hands",
    value: 140,
    type: "bonus",
    note: "Consistency ≥80% AND ≥70% of target WPM — XP scales with consistency smoothstep(80%→97%)",
  },
  {
    label: "Perfect Accuracy (base 250)",
    text: "Perfect Accuracy",
    value: 250,
    type: "bonus",
    note: "100% accuracy — base 250 XP, up to 350 with high speed + consistency",
  },
  {
    label: "Perfect Accuracy (max ~350)",
    text: "Perfect Accuracy",
    value: 342,
    type: "bonus",
    note: "High-performance perfect accuracy — fast + very consistent player",
  },
  {
    label: "Lightning Speed (base 500) — 80–99 WPM",
    text: "Lightning Speed",
    value: 500,
    type: "bonus",
    note: "80+ WPM tier — suppresses Speed Racer. Base 500 XP, up to 700. Exclusive with Speed Racer.",
  },
  {
    label: "Lightning Speed (max ~650) — 95 WPM",
    text: "Lightning Speed",
    value: 648,
    type: "bonus",
    note: "High-end Lightning Speed — 95 WPM + excellent accuracy",
  },
  {
    label: "Speed Racer (base 300) — 60–79 WPM",
    text: "Speed Racer",
    value: 300,
    type: "bonus",
    note: "60–79 WPM tier — fires only at 60–79 WPM (Lightning Speed suppresses this at 80+)",
  },
  {
    label: "Marathon Typist (base 150)",
    text: "Marathon Typist",
    value: 150,
    type: "bonus",
    note: "500+ character text — base 150, scales up to 210 with longer texts + completion",
  },
  {
    label: "Endurance Milestone (amber)",
    text: "Endurance Milestone (1,200 chars)",
    value: 165,
    type: "bonus",
    note: "Long-text milestone tiers — text containing 'Endurance' triggers amber gradient style",
  },
  {
    label: "Character Bonus",
    text: "Character Bonus",
    value: 90,
    type: "bonus",
    note: "Continuous character bonus for long texts — based on chars covered beyond 380",
  },

  // ── Achievements (fire once per account, dynamic reward) ──
  {
    label: "Speed Demon — 100 WPM (base 500)",
    text: "Speed Demon",
    value: 500,
    type: "achievement",
    note: "ACHIEVEMENT — fires only once. Base 500 XP at exactly 100 WPM, scales to 700 XP at 150 WPM.",
  },
  {
    label: "Speed Demon — 130 WPM (~610 XP)",
    text: "Speed Demon",
    value: 612,
    type: "achievement",
    note: "High-speed Speed Demon unlock — dynamic reward based on WPM at time of unlock",
  },

  // ── Other types ──
  { label: "Base XP",   text: "Base XP",        value: 280, type: "base"     },
  { label: "Level Up!", text: "Level Up!",       value: 0,   type: "level-up" },
  { label: "Error",     text: "Invalid session", value: 0,   type: "error"    },

  // ── PvP ranked ──
  { label: "PvP Win",           text: "Ranked Win",       value: 100, type: "pvp-win",    note: "Win a ranked match — base 100 XP" },
  { label: "PvP Loss",          text: "Ranked Match",     value: 25,  type: "pvp-win",    note: "Lose a ranked match — participation 25 XP" },
  { label: "Streak Bonus ×3",   text: "Win Streak ×3",    value: 25,  type: "pvp-streak", note: "3-win streak bonus XP — reddish notification" },
  { label: "Streak Bonus ×5",   text: "Win Streak ×5",    value: 50,  type: "pvp-streak", note: "5-win streak bonus XP" },
  { label: "Streak Bonus ×12",  text: "Win Streak ×12",   value: 100, type: "pvp-streak", note: "12-win streak bonus XP" },
];

// ── Per-type button colours ──────────────────────────────────────────────────
const BUTTON_CLASS: Record<XPMessageType, string> = {
  mythic:            "border-violet-500/50 bg-violet-900/30 hover:bg-violet-800/50 text-violet-200",
  "personal-best":   "border-cyan-500/50   bg-cyan-900/30   hover:bg-cyan-800/50   text-cyan-200",
  achievement:       "border-purple-500/50 bg-purple-900/30 hover:bg-purple-800/50 text-purple-200",
  bonus:             "border-emerald-500/50 bg-emerald-900/30 hover:bg-emerald-800/50 text-emerald-200",
  "daily-challenge": "border-emerald-500/50 bg-emerald-900/30 hover:bg-emerald-800/50 text-emerald-200",
  "level-up":        "border-emerald-500/50 bg-emerald-900/30 hover:bg-emerald-800/50 text-emerald-200",
  base:              "border-white/15       bg-white/5        hover:bg-white/10        text-slate-300",
  participation:     "border-white/15       bg-white/5        hover:bg-white/10        text-slate-300",
  error:             "border-red-500/50    bg-red-950/30    hover:bg-red-900/50    text-red-300",
  "pvp-win":         "border-blue-500/40   bg-blue-900/25   hover:bg-blue-800/40   text-blue-200",
  "pvp-streak":      "border-red-500/50    bg-red-900/25    hover:bg-red-800/40    text-red-200",
};

// ── Component ────────────────────────────────────────────────────────────────
export const XPNotificationTestPanel = () => {
  // Hooks must come before any early return (React rules of hooks)
  const { addXPMessage, clearXPMessages } = useLevel();
  const [isOpen, setIsOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  // Returns null in production — dead-code eliminated by Next.js builds
  if (process.env.NODE_ENV === "production") return null;

  const fireAll = () =>
    PREVIEW_NOTIFICATIONS.forEach((n) => addXPMessage(n.text, n.value, n.type));

  const fireMythicOnly = () =>
    PREVIEW_NOTIFICATIONS
      .filter((n) => n.type === "mythic" || n.type === "personal-best")
      .forEach((n) => addXPMessage(n.text, n.value, n.type));

  return (
    <div className="fixed top-0 z-[9999] select-none font-mono text-xs flex flex-col items-end" style={{ right: 'calc(50% + 2px)' }}>

      {/* ── Toggle button ── */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        title="XP Notification Test Panel (DEV only)"
        className="flex items-center gap-1.5 rounded-b-xl rounded-tr-none border border-t-0 border-r-0 border-violet-500/40 bg-violet-950/90 px-4 py-1.5 text-white shadow-xl backdrop-blur-sm transition-colors hover:bg-violet-900/90"
      >
        <span className="text-[9px] font-bold tracking-widest text-violet-400 uppercase">DEV</span>
        <span className="text-[11px]">{isOpen ? "✕ Close" : "🔔 XP Test"}</span>
      </button>

      {isOpen && (
        <div className="flex flex-col gap-1 rounded-bl-xl border border-t-0 border-r-0 border-violet-500/25 bg-slate-950/97 p-3 shadow-2xl backdrop-blur-md w-64 max-h-[80vh] overflow-y-auto mt-px">

          {/* Header */}
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-violet-400">
            XP Notification Preview
          </p>
          <p className="mb-2 text-[9px] leading-relaxed text-slate-500">
            Each button fires one notification so you can preview its style without a real session.
            Hover a button to see its trigger conditions.
          </p>

          {/* Notification buttons */}
          {PREVIEW_NOTIFICATIONS.map((n) => (
            <button
              key={n.label}
              onClick={() => addXPMessage(n.text, n.value, n.type)}
              onMouseEnter={() => setHovered(n.label)}
              onMouseLeave={() => setHovered(null)}
              className={`relative text-left px-2.5 py-1.5 rounded-lg border transition-colors ${BUTTON_CLASS[n.type] ?? BUTTON_CLASS.base}`}
            >
              <span className="block truncate">{n.label}</span>
              {n.value > 0 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] opacity-50">
                  +{n.value}
                </span>
              )}
            </button>
          ))}

          {/* Tooltip for hovered item */}
          {hovered && (
            <p className="mt-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[9px] leading-relaxed text-slate-400">
              {PREVIEW_NOTIFICATIONS.find((n) => n.label === hovered)?.note ?? hovered}
            </p>
          )}

          {/* Divider */}
          <hr className="my-1 border-white/10" />

          {/* Bulk actions */}
          <button
            onClick={fireMythicOnly}
            className="rounded-lg border border-violet-500/40 bg-violet-900/20 px-2 py-1.5 text-violet-200 transition-colors hover:bg-violet-900/40"
          >
            🌟 Fire Mythic + PB Only
          </button>
          <button
            onClick={fireAll}
            className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-2 py-1.5 text-amber-200 transition-colors hover:bg-amber-900/40"
          >
            🔥 Fire All Notifications
          </button>
          <button
            onClick={() => clearXPMessages?.()}
            className="rounded-lg border border-red-500/40 bg-red-950/20 px-2 py-1.5 text-red-300 transition-colors hover:bg-red-950/50"
          >
            🗑 Clear All
          </button>

          {/* Removal instructions */}
          <p className="mt-2 rounded border border-yellow-500/20 bg-yellow-950/20 px-2 py-1.5 text-[9px] leading-relaxed text-yellow-500/70">
            To remove: delete this file and the import in UserMenu.tsx
            (search: XPNotificationTestPanel)
          </p>
        </div>
      )}
    </div>
  );
};
