"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, TrendingUp, TrendingDown, Sword, Sparkles, Crown, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useSettings } from "@/features/settings/context";

// ── Type definitions ─────────────────────────────────────────────────

export type PvpResultsPlacement = {
  position: number;
  userId: string;
  username: string;
  wpm: number;
  accuracy: number;
  errors: number;
  timeMs: number;
};

export type PvpRatingChange = {
  userId: string;
  before: number;
  after: number;
  delta: number;
};

export type PvpWpmPoint = {
  time: string;
  meWpm: number;
  opponentWpm: number;
};

// ── Rating delta badge ───────────────────────────────────────────────

const RatingDeltaBadge = ({ before, after, delta }: { before: number; after: number; delta: number }) => {
  const isPositive = delta >= 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  return (
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 0.4, type: "spring", stiffness: 380, damping: 22 }}
      className="flex items-center gap-2"
    >
      <div
        className={`flex items-center gap-2 rounded-full px-4 py-1.5 border text-sm font-mono tabular-nums ${
          isPositive
            ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
            : "bg-rose-500/10 border-rose-500/25 text-rose-300"
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-white/50">{before}</span>
        <span className="text-white/25">→</span>
        <span className="font-semibold">{after}</span>
        <span className={`font-bold ml-0.5 ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
          ({isPositive ? "+" : ""}{delta})
        </span>
      </div>
    </motion.div>
  );
};

// ── Placement row ────────────────────────────────────────────────────

const PlacementRow = ({
  placement,
  isMe,
  ratingChange,
  idx,
}: {
  placement: PvpResultsPlacement;
  isMe: boolean;
  ratingChange?: PvpRatingChange;
  idx: number;
}) => {
  const isWinner = placement.position === 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + idx * 0.06, type: "spring", stiffness: 400, damping: 28 }}
      className={`relative flex items-center gap-4 rounded-2xl px-4 py-3.5 border transition-colors ${
        isMe
          ? "bg-cyan-500/10 border-cyan-500/30"
          : "bg-white/[0.03] border-white/[0.07] hover:bg-white/[0.05]"
      }`}
    >
      {/* Position badge */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${
          isWinner
            ? "bg-amber-400/20 text-amber-300 border border-amber-400/30"
            : "bg-white/[0.06] text-white/50 border border-white/10"
        }`}
      >
        {isWinner ? <Crown className="h-4 w-4" /> : `#${placement.position}`}
      </div>

      {/* Username + "You" badge */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-semibold truncate text-sm ${isMe ? "text-cyan-200" : "text-white/90"}`}>
            {placement.username}
          </span>
          {isMe && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 rounded-full px-2 py-0.5">
              You
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-white/40">
          <span>{placement.accuracy}% accuracy</span>
          {placement.errors > 0 && <span>{placement.errors} errors</span>}
          <span>{(placement.timeMs / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {/* WPM */}
      <div className="text-right shrink-0">
        <div className={`text-xl font-black tabular-nums ${isWinner ? "text-amber-300" : isMe ? "text-cyan-300" : "text-white/70"}`}>
          {placement.wpm}
        </div>
        <div className="text-[10px] text-white/30 uppercase tracking-wider">wpm</div>
      </div>

      {/* Rating delta (inline for the local player) */}
      {ratingChange && (
        <div className={`text-xs font-bold tabular-nums shrink-0 ${ratingChange.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {ratingChange.delta >= 0 ? "+" : ""}{ratingChange.delta}
        </div>
      )}
    </motion.div>
  );
};

// ── Main overlay ─────────────────────────────────────────────────────

export default function PvpResultsOverlay(props: {
  open: boolean;
  title?: string;
  primaryActionLabel?: string;
  placements: PvpResultsPlacement[];
  ratingChanges: PvpRatingChange[];
  chartData: PvpWpmPoint[];
  meUserId: string | null;
  opponentName: string;
  canRematch: boolean;
  rematchOfferFromUserId: string | null;
  rematchAcceptedUserIds: string[];
  rematchDeclinedReason: string | null;
  isSearchingNewOpponent?: boolean;
  onRequestRematch: () => void;
  onAcceptRematch: () => void;
  onDeclineRematch: () => void;
  onFindNewOpponent: () => void;
}) {
  const { settings } = useSettings();

  const {
    open,
    title = "Race Results",
    primaryActionLabel = "Find a new typer",
    placements,
    ratingChanges,
    chartData,
    meUserId,
    opponentName,
    canRematch,
    rematchOfferFromUserId,
    rematchAcceptedUserIds,
    rematchDeclinedReason,
    isSearchingNewOpponent = false,
    onRequestRematch,
    onAcceptRematch,
    onDeclineRematch,
    onFindNewOpponent,
  } = props;

  const chartConfig = React.useMemo(
    () =>
      ({
        meWpm: { label: "You", color: "#22d3ee" },
        opponentWpm: { label: opponentName || "Opponent", color: "#c084fc" },
      }) satisfies ChartConfig,
    [opponentName],
  );

  if (!open) return null;

  const myPlacement = meUserId ? placements.find((p) => p.userId === meUserId) : null;
  const myChange = meUserId ? ratingChanges.find((r) => r.userId === meUserId) ?? null : null;
  const didWin = myPlacement?.position === 1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          // Full-viewport overlay, scrollable so content is never clipped
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm px-4 py-8"
        >
          <motion.div
            initial={{ y: 24, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 12, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 26 }}
            className="w-full max-w-2xl"
          >
            {/* ── Glass panel ── */}
            <div className="relative overflow-hidden rounded-3xl border border-white/[0.09] bg-[#0c0f1a]/95 shadow-[0_32px_80px_-12px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.06)]">

              {/* Ambient glow */}
              <div className="pointer-events-none absolute inset-0 rounded-3xl overflow-hidden">
                <div
                  className={`absolute -inset-px opacity-30 blur-2xl ${
                    didWin
                      ? "bg-gradient-to-br from-amber-500/20 via-cyan-500/10 to-transparent"
                      : "bg-gradient-to-br from-purple-500/15 via-cyan-500/10 to-transparent"
                  }`}
                />
              </div>

              {/* ── Header ── */}
              <div className="relative px-6 pt-6 pb-4 border-b border-white/[0.06]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {didWin ? (
                        <Trophy className="h-5 w-5 text-amber-400" />
                      ) : (
                        <Sword className="h-5 w-5 text-purple-400" />
                      )}
                      <h2
                        className={`text-2xl font-black tracking-tight text-transparent bg-clip-text ${
                          didWin
                            ? "bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400"
                            : "bg-gradient-to-r from-white via-slate-100 to-slate-300"
                        }`}
                      >
                        {didWin ? "You Win!" : title}
                      </h2>
                    </div>
                    <p className="text-sm text-white/45">
                      Typing race vs{" "}
                      <span className="font-semibold text-purple-300">{opponentName}</span>
                    </p>
                  </div>

                  {/* Win/Loss indicator */}
                  <div
                    className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest border ${
                      didWin
                        ? "bg-amber-400/10 border-amber-400/25 text-amber-300"
                        : "bg-rose-500/10 border-rose-500/25 text-rose-300"
                    }`}
                  >
                    <Zap className="h-3 w-3" />
                    {didWin ? "Won" : "Lost"}
                  </div>
                </div>
              </div>

              {/* ── Body ── */}
              <div className="px-6 py-5 space-y-5">

                {/* Placements */}
                <div className="space-y-2">
                  {placements.map((p, idx) => (
                    <PlacementRow
                      key={p.userId}
                      placement={p}
                      isMe={p.userId === meUserId}
                      ratingChange={ratingChanges.find((r) => r.userId === p.userId)}
                      idx={idx}
                    />
                  ))}
                </div>

                {/* Rating change */}
                {myChange && (
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="text-xs text-white/35 uppercase tracking-wider font-medium">Rank Score</span>
                    <RatingDeltaBadge before={myChange.before} after={myChange.after} delta={myChange.delta} />
                  </div>
                )}

                {/* WPM chart */}
                {settings.showSessionChart && chartData.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3"
                  >
                    <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2 px-1">Speed through the race</p>
                    <ChartContainer config={chartConfig} className="h-[160px] w-full">
                      <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                        <defs>
                          <linearGradient id="fillMeWpm" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="fillOpponentWpm" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#c084fc" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#c084fc" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" strokeDasharray="4 4" />
                        <XAxis dataKey="time" tickLine={false} axisLine={false} tickMargin={6} minTickGap={20} stroke="rgba(255,255,255,0.18)" fontSize={9} />
                        <YAxis tickLine={false} axisLine={false} tickMargin={4} stroke="rgba(255,255,255,0.18)" fontSize={9} />
                        <ChartTooltip cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }} content={<ChartTooltipContent indicator="dot" />} />
                        <Area dataKey="meWpm" type="monotone" fill="url(#fillMeWpm)" stroke="#22d3ee" strokeWidth={2} dot={false} activeDot={{ r: 3.5, strokeWidth: 0 }} />
                        <Area dataKey="opponentWpm" type="monotone" fill="url(#fillOpponentWpm)" stroke="#c084fc" strokeWidth={2} dot={false} activeDot={{ r: 3.5, strokeWidth: 0 }} />
                        <ChartLegend content={<ChartLegendContent className="text-white/50 text-[10px]" />} />
                      </AreaChart>
                    </ChartContainer>
                  </motion.div>
                )}

                {/* ── Actions ── */}
                <div className="space-y-2.5 pt-1">
                  {canRematch && (
                    <>
                      {rematchDeclinedReason ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                          className="text-sm text-rose-400 bg-rose-500/10 rounded-xl px-4 py-2.5 border border-rose-500/20 text-center">
                          Opponent declined the rematch.
                        </motion.div>
                      ) : rematchOfferFromUserId ? (
                        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                          className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                          <Sparkles className="h-4 w-4 text-amber-400 animate-pulse shrink-0" />
                          <span className="text-sm text-amber-100 flex-1">{opponentName} wants another race!</span>
                          <div className="flex gap-2 shrink-0">
                            <Button onClick={onAcceptRematch} size="sm"
                              className="rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5">
                              Race again
                            </Button>
                            <Button onClick={onDeclineRematch} variant="outline" size="sm"
                              className="rounded-full border-rose-500/40 text-rose-300 hover:bg-rose-500/10 px-5">
                              Decline
                            </Button>
                          </div>
                        </motion.div>
                      ) : rematchAcceptedUserIds.length > 0 ? (
                        <div className="flex items-center justify-center gap-2 text-sm text-white/50 bg-white/[0.03] rounded-xl px-4 py-3 border border-white/[0.06]">
                          <svg className="animate-spin h-4 w-4 text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Waiting for the other typer...
                        </div>
                      ) : (
                        <Button onClick={onRequestRematch} variant="secondary"
                          className="w-full rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-200 hover:bg-purple-500/20 hover:text-purple-100 transition-all font-semibold h-11">
                          <Sword className="h-4 w-4 mr-2" /> Race again
                        </Button>
                      )}
                    </>
                  )}

                  {isSearchingNewOpponent ? (
                    <div className="flex items-center justify-center gap-2 text-sm text-white/50 bg-white/[0.03] rounded-full px-4 py-3 border border-white/[0.06]">
                      <svg className="animate-spin h-4 w-4 text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Finding your next typer...
                    </div>
                  ) : (
                    <Button variant="outline" onClick={onFindNewOpponent}
                      className="w-full rounded-full border-white/15 bg-transparent text-white/70 hover:bg-white/8 hover:text-white h-11 font-medium">
                      {primaryActionLabel}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

