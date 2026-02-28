// src/app/profile/account-stats-chart.tsx
"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  XAxis,
} from "recharts";
import { motion, type Variants } from "framer-motion";
import {
  RadarIcon,
  PieChartIcon,
  TrendingUpIcon,
  CpuIcon,
  ActivityIcon,
  AwardIcon,
  FlameIcon,
  SparklesIcon,
} from "lucide-react";

import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

import {
  computePerformanceIntelligence,
  type PerformanceTrendCategory,
} from "@/features/typing/utils/performance-intelligence";

import { NumberAnimation } from "@/components/core/number-animation-view";

type LongTermStats = {
  totalSessions: number;
  totalTimeTyped: number;
  totalWordsTyped: number;
  totalCharactersTyped: number;
  totalMistakes: number;
  totalCorrections: number;
  averageWPM: number;
  averageAccuracy: number;
  averageConsistency: number;
  bestWPM: number;
  bestWPMDate: string | null;
  bestAccuracy: number;
  bestAccuracyDate: string | null;
  lastUpdated: string;
};

type DailyTypingActivity = {
  localDate: string;
  sessionsCount: number;
  totalTimeSpentSec: number;
  sumWpm: number;
  sumWpmTime: number;
  sumAccuracy: number;
};

type SessionHistoryEntry = {
  id: string;
  timestamp: string;
  textType?: "SHORT" | "MEDIUM" | "LONG";
  textLength: number;
  wpm?: number;
  accuracy?: number;
  consistency?: number;
  timeSpent?: number;
  mistakes?: number;
  corrections?: number;
  localDate?: string;
};

type DailySeriesPoint = {
  localDate: string;
  sessionsCount: number;
  avgWpm: number;
  avgAccuracy: number;
  totalMinutes: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function classifyByLength(textLength: number): "SHORT" | "MEDIUM" | "LONG" {
  if (textLength >= 420) return "LONG";
  if (textLength >= 180) return "MEDIUM";
  return "SHORT";
}

function resolveTextType(session: SessionHistoryEntry): "SHORT" | "MEDIUM" | "LONG" {
  if (session.textType === "SHORT" || session.textType === "MEDIUM" || session.textType === "LONG") {
    return session.textType;
  }
  return classifyByLength(session.textLength);
}

function computeDailyPerformanceIndex(avgWpm: number, avgAccuracy: number) {
  const wpmScore = clamp(Math.round((avgWpm / 120) * 100), 0, 100);
  const accScore = clamp(Math.round(avgAccuracy), 0, 100);
  return 0.6 * wpmScore + 0.4 * accScore;
}

function parseLocalDay(localDate: string): number {
  const [yearRaw, monthRaw, dayRaw] = localDate.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 0;
  return Date.UTC(year, month - 1, day);
}

function formatShortDate(localDate: string): string {
  const d = new Date(`${localDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return localDate;
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

function computeStreaks(localDatesAsc: string[]) {
  if (localDatesAsc.length === 0) return { longest: 0, current: 0 };

  let longest = 1;
  let run = 1;

  for (let i = 1; i < localDatesAsc.length; i++) {
    const prev = parseLocalDay(localDatesAsc[i - 1]);
    const cur = parseLocalDay(localDatesAsc[i]);
    const isConsecutive = prev > 0 && cur > 0 && cur - prev === 86400000;

    if (isConsecutive) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Current streak counts backwards from the most recent day.
  let current = 1;
  for (let i = localDatesAsc.length - 1; i >= 1; i--) {
    const prev = parseLocalDay(localDatesAsc[i - 1]);
    const cur = parseLocalDay(localDatesAsc[i]);
    const isConsecutive = prev > 0 && cur > 0 && cur - prev === 86400000;

    if (isConsecutive) current += 1;
    else break;
  }

  return { longest, current };
}

function sum(values: number[]) {
  return values.reduce((acc, v) => acc + v, 0);
}

function mean(values: number[]) {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function quantile(values: number[], q: number) {
  if (values.length === 0) return 0;
  const qq = clamp(q, 0, 1);
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * qq;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

function weightedMean(values: number[], weights: number[]) {
  const n = Math.min(values.length, weights.length);
  if (n === 0) return 0;
  let wSum = 0;
  let vwSum = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const w = weights[i];
    if (!Number.isFinite(v) || !Number.isFinite(w) || w <= 0) continue;
    wSum += w;
    vwSum += v * w;
  }
  return wSum > 0 ? vwSum / wSum : 0;
}

function formatTrendCategory(category: PerformanceTrendCategory) {
  switch (category) {
    case "ACCELERATING":
      return "Accelerating";
    case "IMPROVING":
      return "Improving";
    case "DECLINING":
      return "Declining";
    default:
      return "Stable";
  }
}

function classifyPlayerLevel(compositeIndex: number): { label: string; note: string } {
  const score = clamp(Math.round(compositeIndex), 0, 100);
  if (score >= 90) return { label: "Elite", note: "Top-tier overall performance" };
  if (score >= 75) return { label: "Expert", note: "Strong across most dimensions" };
  if (score >= 60) return { label: "Advanced", note: "Consistently solid" };
  if (score >= 45) return { label: "Intermediate", note: "Good base with room to grow" };
  return { label: "Beginner", note: "Early stage — focus on consistency" };
}

export default function AccountStatsChart({
  stats,
  dailyActivity,
  sessionHistory,
}: {
  stats: LongTermStats;
  dailyActivity: DailyTypingActivity[];
  sessionHistory: SessionHistoryEntry[];
}) {
  const sessionInsights = React.useMemo(() => {
    const sessions = [...(sessionHistory ?? [])]
      .filter((s) => typeof s.wpm === "number" && Number.isFinite(s.wpm))
      .map((s) => {
        const wpm = clamp(s.wpm ?? 0, 0, 500);
        const accuracy = clamp(s.accuracy ?? 0, 0, 100);
        const timeSpent = Math.max(0, Math.floor(s.timeSpent ?? 0));
        const textLength = Math.max(0, Math.floor(s.textLength ?? 0));
        const mistakes = Math.max(0, Math.floor(s.mistakes ?? 0));
        const corrections = Math.max(0, Math.floor(s.corrections ?? 0));

        return {
          wpm,
          accuracy,
          timeSpent,
          textLength,
          mistakes,
          corrections,
        };
      });

    const count = sessions.length;
    const wpm = sessions.map((s) => s.wpm);
    const accuracy = sessions.map((s) => s.accuracy);
    const weights = sessions.map((s) => s.timeSpent);

    const timeWeightedWpm = weightedMean(wpm, weights);
    const timeWeightedAccuracy = weightedMean(accuracy, weights);
    const effectiveWpm = weightedMean(
      sessions.map((s) => s.wpm * (s.accuracy / 100)),
      weights
    );

    const medianWpm = quantile(wpm, 0.5);
    const p90Wpm = quantile(wpm, 0.9);

    const timeSpentValues = sessions.map((s) => s.timeSpent).filter((t) => t > 0);
    const avgSessionSec = mean(timeSpentValues);
    const deepFocusSharePct = count === 0 ? 0 : (sessions.filter((s) => s.timeSpent >= 120).length / count) * 100;

    const totalChars = sum(sessions.map((s) => s.textLength).filter((v) => v > 0));
    const totalMistakes = sum(sessions.map((s) => s.mistakes));
    const totalCorrections = sum(sessions.map((s) => s.corrections));

    const mistakesPer100Chars = totalChars > 0 ? (totalMistakes / totalChars) * 100 : 0;
    const correctionsPer100Chars = totalChars > 0 ? (totalCorrections / totalChars) * 100 : 0;

    const enoughForPercentiles = count >= 10;

    return {
      count,
      enoughForPercentiles,
      timeWeightedWpm,
      timeWeightedAccuracy,
      effectiveWpm,
      medianWpm,
      p90Wpm,
      avgSessionSec,
      deepFocusSharePct,
      mistakesPer100Chars,
      correctionsPer100Chars,
    };
  }, [sessionHistory]);

  const pieData = React.useMemo(() => {
    const buckets = {
      short: 0,
      medium: 0,
      long: 0,
    };

    for (const session of sessionHistory) {
      const textType = resolveTextType(session);
      if (textType === "SHORT") buckets.short += 1;
      if (textType === "MEDIUM") buckets.medium += 1;
      if (textType === "LONG") buckets.long += 1;
    }

    return [
      { key: "short", label: "Short", value: buckets.short, fill: "var(--color-short)" },
      { key: "medium", label: "Medium", value: buckets.medium, fill: "var(--color-medium)" },
      { key: "long", label: "Long", value: buckets.long, fill: "var(--color-long)" },
    ];
  }, [sessionHistory]);

  const intelligence = React.useMemo(() => {
    return computePerformanceIntelligence({
      dailyActivity,
      stats: {
        averageWPM: stats.averageWPM,
        averageAccuracy: stats.averageAccuracy,
        averageConsistency: stats.averageConsistency,
        totalMistakes: stats.totalMistakes,
        totalCorrections: stats.totalCorrections,
        totalCharactersTyped: stats.totalCharactersTyped,
      },
      windowDays: 28,
    });
  }, [
    dailyActivity,
    stats.averageAccuracy,
    stats.averageConsistency,
    stats.averageWPM,
    stats.totalCharactersTyped,
    stats.totalCorrections,
    stats.totalMistakes,
  ]);

  const recentVsPrevious14 = React.useMemo(() => {
    const active = [...(dailyActivity ?? [])]
      .filter((row) => row.sessionsCount > 0)
      .sort((a, b) => parseLocalDay(a.localDate) - parseLocalDay(b.localDate));

    const series = active.map((row) => {
      const sessions = Math.max(1, row.sessionsCount);
      const totalMinutes = Math.round(Math.max(0, row.totalTimeSpentSec) / 60);
      const hasTimeWeightedWpm = row.totalTimeSpentSec > 0 && row.sumWpmTime > 0;
      const avgWpm = hasTimeWeightedWpm ? row.sumWpmTime / row.totalTimeSpentSec : row.sumWpm / sessions;
      return {
        localDate: row.localDate,
        sessionsCount: row.sessionsCount,
        totalMinutes,
        avgWpm,
      };
    });

    const last28 = series.slice(Math.max(0, series.length - 28));
    const recent = last28.slice(Math.max(0, last28.length - 14));
    const previous = last28.slice(Math.max(0, last28.length - 28), Math.max(0, last28.length - 14));

    const hasPreviousWindow = previous.length === 14 && recent.length === 14;
    const showPreviousSeries = hasPreviousWindow && recent.length >= 2;

    const chartData = recent.map((row, idx) => {
      const prev = showPreviousSeries ? previous[idx] : undefined;
      return {
        date: formatShortDate(row.localDate),
        wpm: row.avgWpm,
        prevWpm: prev ? prev.avgWpm : null,
      };
    });

    const recentAvgWpm = mean(recent.map((d) => d.avgWpm));
    const previousAvgWpm = mean(previous.map((d) => d.avgWpm));

    const recentSessions = sum(recent.map((d) => d.sessionsCount));
    const recentMinutes = sum(recent.map((d) => d.totalMinutes));

    return {
      pointsUsed: last28.length,
      recentDaysUsed: recent.length,
      previousDaysUsed: previous.length,
      hasPreviousWindow,
      showPreviousSeries,
      chartData,
      recentAvgWpm,
      previousAvgWpm,
      deltaWpm: recentAvgWpm - previousAvgWpm,
      recentSessions,
      recentMinutes,
    };
  }, [dailyActivity]);

  const advanced = React.useMemo(() => {
    const active = [...(dailyActivity ?? [])]
      .filter((row) => row.sessionsCount > 0)
      .sort((a, b) => parseLocalDay(a.localDate) - parseLocalDay(b.localDate));

    const series: DailySeriesPoint[] = active.map((row) => {
      const sessionsCount = Math.max(1, row.sessionsCount);
      const hasTimeWeightedWpm = row.totalTimeSpentSec > 0 && row.sumWpmTime > 0;
      const avgWpm = hasTimeWeightedWpm ? row.sumWpmTime / row.totalTimeSpentSec : row.sumWpm / sessionsCount;
      const avgAccuracy = row.sumAccuracy / sessionsCount;
      const totalMinutes = Math.round(Math.max(0, row.totalTimeSpentSec) / 60);

      return {
        localDate: row.localDate,
        sessionsCount: row.sessionsCount,
        avgWpm,
        avgAccuracy,
        totalMinutes,
      };
    });

    const last28 = series.slice(Math.max(0, series.length - 28));

    const bestDay = last28.reduce<null | (DailySeriesPoint & { index: number })>((best, row) => {
      const index = computeDailyPerformanceIndex(row.avgWpm, row.avgAccuracy);
      if (!best || index > best.index) return { ...row, index };
      return best;
    }, null);

    const datesAsc = series.map((d) => d.localDate);
    const streaks = computeStreaks(datesAsc);

    const recent7 = last28.slice(Math.max(0, last28.length - 7));
    const prev7 = last28.slice(Math.max(0, last28.length - 14), Math.max(0, last28.length - 7));

    const recentWpm = mean(recent7.map((d) => d.avgWpm));
    const prevWpm = mean(prev7.map((d) => d.avgWpm));
    const recentAcc = mean(recent7.map((d) => d.avgAccuracy));
    const prevAcc = mean(prev7.map((d) => d.avgAccuracy));

    const wpmDelta7 = recentWpm - prevWpm;
    const accDelta7 = recentAcc - prevAcc;

    return {
      pointsUsed: intelligence.trend.pointsUsed,
      confidencePct: Math.round(intelligence.trend.r2 * 100),
      volatilityCvPct: Math.round(intelligence.trend.volatilityCv * 100),
      stabilityScore: Math.round(intelligence.trend.stabilityScore),
      bestDay,
      streaks,
      wpmDelta7,
      accDelta7,
    };
  }, [dailyActivity, intelligence.trend.pointsUsed, intelligence.trend.r2, intelligence.trend.stabilityScore, intelligence.trend.volatilityCv]);

  const radarData = React.useMemo(() => {
    const consistencyScore = clamp(Math.round(intelligence.scores.consistencyScore), 0, 100);
    const wpmScore = clamp(Math.round(intelligence.scores.wpmScore), 0, 100);
    const accuracyScore = clamp(Math.round(intelligence.scores.accuracyScore), 0, 100);
    const cleanlinessScore = clamp(Math.round(intelligence.scores.cleanlinessScore), 0, 100);
    const stabilityScore = clamp(Math.round(intelligence.scores.stabilityScore), 0, 100);

    return [
      { metric: "Consistency", score: consistencyScore },
      { metric: "WPM score", score: wpmScore },
      { metric: "Accuracy", score: accuracyScore },
      { metric: "Cleanliness", score: cleanlinessScore },
      { metric: "Stability", score: stabilityScore },
    ];
  }, [
    intelligence.scores,
  ]);

  const trendHeadline = React.useMemo(() => {
    const label = formatTrendCategory(intelligence.trend.category);
    return label;
  }, [intelligence.scores.stabilityScore, intelligence.trend.category]);

  const playerLevel = React.useMemo(() => {
    return classifyPlayerLevel(intelligence.scores.compositeIndex);
  }, [intelligence.scores.compositeIndex]);

  const pieConfig = {
    short: { label: "Short", color: "hsl(var(--chart-1))" },
    medium: { label: "Medium", color: "hsl(var(--chart-2))" },
    long: { label: "Long", color: "hsl(var(--chart-3))" },
    sessions: { label: "Sessions" },
  } satisfies ChartConfig;

  const radarConfig = {
    score: { label: "Strength", color: "hsl(var(--chart-1))" },
  } satisfies ChartConfig;

  const totalSessions = pieData.reduce((sum, row) => sum + row.value, 0);

  const recentVsPreviousChartConfig = {
    wpm: { label: "Last 14 active days", color: "hsl(var(--chart-1))" },
    prevWpm: { label: "Previous 14", color: "hsl(var(--chart-3))" },
  } satisfies ChartConfig;

  // Animation variants for staggered cards
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.1,
      },
    },
  };

  const cardVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 300, damping: 25 },
    },
  };

  const headerIconVariants: Variants = {
    hidden: { scale: 0.8, opacity: 0 },
    visible: { scale: 1, opacity: 1, transition: { delay: 0.2, type: "spring" as const } },
  };

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Performance Profile Card */}
      <motion.section
        variants={cardVariants}
        className="rounded-xl bg-[rgba(20,50,80,0.3)] backdrop-blur-sm border border-[rgba(160,220,255,0.15)] p-6 hover:border-[rgba(160,220,255,0.3)] transition-all shadow-xl"
      >
        <div className="flex items-center gap-3 mb-4">
          <motion.div variants={headerIconVariants} className="p-2 rounded-lg bg-[rgba(160,220,255,0.1)]">
            <RadarIcon className="w-5 h-5 text-cyan-300" />
          </motion.div>
          <h3 className="text-lg font-medium bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400">
            Performance Profile
          </h3>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartContainer config={radarConfig} className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid className="opacity-35" gridType="circle" stroke="rgba(160,220,255,0.2)" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: "#8A8FB5", fontSize: 12 }} />
                <Radar
                  dataKey="score"
                  fill="var(--color-score)"
                  stroke="var(--color-score)"
                  fillOpacity={0.35}
                />
              </RadarChart>
            </ResponsiveContainer>
          </ChartContainer>
          <div>
            <div className="mb-4 flex items-center gap-2">
              <ActivityIcon className="w-4 h-4 text-cyan-300" />
              <div className="text-sm text-[rgba(200,240,255,0.8)] uppercase tracking-wider ">Trend</div>
              <div className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400 ">
                {trendHeadline}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.2)] p-3 backdrop-blur-sm hover:border-[rgba(160,220,255,0.3)] transition-all">
                <div className="text-xs text-[rgba(200,240,255,0.6)] ">Player level</div>
                <div className="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400 ">
                  {playerLevel.label}
                </div>
                <div className="mt-1 text-xs text-[#8A8FB5] ">{playerLevel.note}</div>
              </div>
              <div className="rounded-lg border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.2)] p-3 backdrop-blur-sm hover:border-[rgba(160,220,255,0.3)] transition-all">
                <div className="text-xs text-[rgba(200,240,255,0.6)] ">Stability</div>
                <div className="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400">
                  <NumberAnimation value={intelligence.scores.stabilityScore} delay={0.35} />
                  <span className="ml-1 text-sm text-slate-400">/100</span>
                </div>
                <div className="mt-1 text-xs text-[#8A8FB5]">Higher = steadier performance</div>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Session Distribution Card */}
      <motion.section
        variants={cardVariants}
        className="rounded-xl bg-[rgba(20,50,80,0.3)] backdrop-blur-sm border border-[rgba(80,210,150,0.15)] p-6 hover:border-[rgba(80,210,150,0.3)] transition-all shadow-xl"
      >
        <div className="flex items-center gap-3 mb-4">
          <motion.div variants={headerIconVariants} className="p-2 rounded-lg bg-[rgba(80,210,150,0.1)]">
            <PieChartIcon className="w-5 h-5 text-green-300" />
          </motion.div>
          <h3 className="text-lg font-medium bg-clip-text text-transparent bg-gradient-to-r from-green-300 to-teal-400">
            Session Distribution
          </h3>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartContainer config={pieConfig} className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Pie data={pieData} dataKey="value" nameKey="label" innerRadius={48} outerRadius={88}>
                  {pieData.map((entry) => (
                    <Cell key={entry.key} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
          <div className="space-y-4">
            <div className="flex justify-between text-sm border-b border-[rgba(80,210,150,0.2)] pb-2">
              <span className="text-[rgba(200,240,255,0.8)]">Total sessions:</span>
              <span className="font-medium text-[#E0E7FF]">
                <NumberAnimation value={totalSessions} delay={0.5} />
              </span>
            </div>
            {pieData.map((item, idx) => (
              <div key={item.key} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span className="text-[rgba(200,240,255,0.8)]">{item.label}</span>
                </div>
                <span className="font-medium text-[#E0E7FF]">
                  <NumberAnimation value={item.value} delay={0.6 + idx * 0.1} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Recent vs Previous Card */}
      <motion.section
        variants={cardVariants}
        className="rounded-xl bg-[rgba(20,50,80,0.3)] backdrop-blur-sm border border-[rgba(160,220,255,0.15)] p-6 hover:border-[rgba(160,220,255,0.3)] transition-all shadow-xl"
      >
        <div className="flex items-center gap-3 mb-4">
          <motion.div variants={headerIconVariants} className="p-2 rounded-lg bg-[rgba(160,220,255,0.1)]">
            <TrendingUpIcon className="w-5 h-5 text-cyan-300" />
          </motion.div>
          <h3 className="text-lg font-medium bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400">
            Recent vs Previous (14 days)
          </h3>
        </div>
        <ChartContainer config={recentVsPreviousChartConfig} className="mt-4 h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={recentVsPrevious14.chartData}>
              <CartesianGrid vertical={false} className="opacity-20" stroke="rgba(160,220,255,0.1)" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fill: "#8A8FB5", fontSize: 12 }}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
              <Area
                dataKey="wpm"
                type="natural"
                fill="var(--color-wpm)"
                stroke="var(--color-wpm)"
                fillOpacity={0.15}
                strokeWidth={2}
              />
              {recentVsPrevious14.showPreviousSeries && (
                <Area
                  dataKey="prevWpm"
                  type="natural"
                  fill="var(--color-prevWpm)"
                  stroke="var(--color-prevWpm)"
                  fillOpacity={0.08}
                  strokeWidth={2}
                />
              )}
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-5">
          <div className="text-center p-3 bg-[rgba(20,50,80,0.2)] rounded-lg border border-[rgba(160,220,255,0.1)] backdrop-blur-sm">
            <div className="text-xs text-[rgba(200,240,255,0.6)]">Recent avg WPM</div>
            <div className="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400 font-mono">
              <NumberAnimation value={recentVsPrevious14.recentAvgWpm} delay={0.7} decimals={1} />
            </div>
          </div>
          <div className="text-center p-3 bg-[rgba(20,50,80,0.2)] rounded-lg border border-[rgba(160,220,255,0.1)] backdrop-blur-sm">
            <div className="text-xs text-[rgba(200,240,255,0.6)]">Previous avg WPM</div>
            <div className="text-lg font-semibold text-[#E0E7FF] font-mono">
              {recentVsPrevious14.hasPreviousWindow ? (
                <NumberAnimation value={recentVsPrevious14.previousAvgWpm} delay={0.8} />
              ) : (
                "—"
              )}
            </div>
          </div>
          <div className="text-center p-3 bg-[rgba(20,50,80,0.2)] rounded-lg border border-[rgba(160,220,255,0.1)] backdrop-blur-sm">
            <div className="text-xs text-[rgba(200,240,255,0.6)]">Δ WPM</div>
            <div className={`text-lg font-semibold font-mono ${recentVsPrevious14.deltaWpm >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {recentVsPrevious14.hasPreviousWindow ? (
                <>
                  {recentVsPrevious14.deltaWpm >= 0 ? '+' : ''}
                  <NumberAnimation value={recentVsPrevious14.deltaWpm} delay={0.9} />
                </>
              ) : "—"}
            </div>
          </div>
          <div className="text-center p-3 bg-[rgba(20,50,80,0.2)] rounded-lg border border-[rgba(160,220,255,0.1)] backdrop-blur-sm">
            <div className="text-xs text-[rgba(200,240,255,0.6)]">Recent sessions</div>
            <div className="text-lg font-semibold text-[#E0E7FF] font-mono">
              <NumberAnimation value={recentVsPrevious14.recentSessions} delay={1.0} />
            </div>
          </div>
          <div className="text-center p-3 bg-[rgba(20,50,80,0.2)] rounded-lg border border-[rgba(160,220,255,0.1)] backdrop-blur-sm">
            <div className="text-xs text-[rgba(200,240,255,0.6)]">Recent minutes</div>
            <div className="text-lg font-semibold text-[#E0E7FF] font-mono">
              <NumberAnimation value={recentVsPrevious14.recentMinutes} delay={1.1} />
            </div>
          </div>
        </div>
      </motion.section>

      {/* Advanced Analytics Card */}
      <motion.section
        variants={cardVariants}
        className="rounded-xl bg-[rgba(20,50,80,0.3)] backdrop-blur-sm border border-[rgba(220,180,255,0.15)] p-6 hover:border-[rgba(220,180,255,0.3)] transition-all shadow-xl"
      >
        <div className="flex items-center gap-3 mb-4">
          <motion.div variants={headerIconVariants} className="p-2 rounded-lg bg-[rgba(220,180,255,0.1)]">
            <CpuIcon className="w-5 h-5 text-purple-300" />
          </motion.div>
          <h3 className="text-lg font-medium bg-clip-text text-transparent bg-gradient-to-r from-purple-300 to-pink-400">
            Advanced Analytics
          </h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-[rgba(220,180,255,0.15)] bg-[rgba(20,50,80,0.2)] p-3 backdrop-blur-sm hover:border-[rgba(220,180,255,0.3)] transition-all">
            <div className="flex items-center gap-1 mb-1">
              <SparklesIcon className="w-3 h-3 text-purple-300" />
              <div className="text-xs text-[rgba(200,240,255,0.6)]">Trend confidence</div>
            </div>
            <div className="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-purple-300 to-pink-400 font-mono">
              <NumberAnimation value={advanced.confidencePct} unit="%" delay={1.2} />
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono">Based on R² (higher = clearer trend)</div>
          </div>
          <div className="rounded-lg border border-[rgba(220,180,255,0.15)] bg-[rgba(20,50,80,0.2)] p-3 backdrop-blur-sm hover:border-[rgba(220,180,255,0.3)] transition-all">
            <div className="flex items-center gap-1 mb-1">
              <ActivityIcon className="w-3 h-3 text-purple-300" />
              <div className="text-xs text-[rgba(200,240,255,0.6)]">Volatility</div>
            </div>
            <div className="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-amber-300 to-orange-400 font-mono">
              <NumberAnimation value={advanced.volatilityCvPct} unit="%" delay={1.3} />
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono">Lower = steadier performance</div>
          </div>
          <div className="rounded-lg border border-[rgba(220,180,255,0.15)] bg-[rgba(20,50,80,0.2)] p-3 backdrop-blur-sm hover:border-[rgba(220,180,255,0.3)] transition-all">
            <div className="flex items-center gap-1 mb-1">
              <FlameIcon className="w-3 h-3 text-purple-300" />
              <div className="text-xs text-[rgba(200,240,255,0.6)]">Streaks</div>
            </div>
            <div className="text-xl font-semibold text-[#E0E7FF] font-mono">
              <NumberAnimation value={advanced.streaks.current} delay={1.4} /> / <NumberAnimation value={advanced.streaks.longest} delay={1.45} />
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono">Current / longest active-day streak</div>
          </div>
          <div className="rounded-lg border border-[rgba(220,180,255,0.15)] bg-[rgba(20,50,80,0.2)] p-3 backdrop-blur-sm hover:border-[rgba(220,180,255,0.3)] transition-all">
            <div className="flex items-center gap-1 mb-1">
              <TrendingUpIcon className="w-3 h-3 text-purple-300" />
              <div className="text-xs text-[rgba(200,240,255,0.6)]">7-day shift</div>
            </div>
            <div className={`text-xl font-semibold text-[rgba(160,220,255,1)] font-mono`}>
              {advanced.wpmDelta7 >= 0 ? '+' : ''}
              <NumberAnimation value={advanced.wpmDelta7} delay={1.5} /> WPM
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-[rgba(220,180,255,0.15)] bg-[rgba(20,50,80,0.2)] p-3 backdrop-blur-sm hover:border-[rgba(220,180,255,0.3)] transition-all">
            <div className="flex items-center gap-1 mb-1">
              <CpuIcon className="w-3 h-3 text-purple-300" />
              <div className="text-xs text-[rgba(200,240,255,0.6)]">Effective WPM</div>
            </div>
            <div className="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-purple-300 to-pink-400 font-mono">
              <NumberAnimation value={sessionInsights.effectiveWpm} delay={1.55} decimals={1} />
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono">Time-weighted: WPM × (accuracy)</div>
          </div>

          <div className="rounded-lg border border-[rgba(220,180,255,0.15)] bg-[rgba(20,50,80,0.2)] p-3 backdrop-blur-sm hover:border-[rgba(220,180,255,0.3)] transition-all">
            <div className="flex items-center gap-1 mb-1">
              <TrendingUpIcon className="w-3 h-3 text-purple-300" />
              <div className="text-xs text-[rgba(200,240,255,0.6)]">P90 WPM</div>
            </div>
            <div className="text-xl font-semibold text-[#E0E7FF] font-mono">
              {sessionInsights.enoughForPercentiles ? (
                <NumberAnimation value={sessionInsights.p90Wpm} delay={1.6} decimals={1} />
              ) : (
                "—"
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono">Top 10% speed (needs 10+ sessions)</div>
          </div>

          <div className="rounded-lg border border-[rgba(220,180,255,0.15)] bg-[rgba(20,50,80,0.2)] p-3 backdrop-blur-sm hover:border-[rgba(220,180,255,0.3)] transition-all">
            <div className="flex items-center gap-1 mb-1">
              <ActivityIcon className="w-3 h-3 text-purple-300" />
              <div className="text-xs text-[rgba(200,240,255,0.6)]">Error rate</div>
            </div>
            <div className="text-xl font-semibold text-[#E0E7FF] font-mono">
              <NumberAnimation value={sessionInsights.mistakesPer100Chars} delay={1.65} decimals={2} />
              <span className="ml-1 text-sm text-slate-400">/100c</span>
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono">Mistakes per 100 typed chars</div>
          </div>

          <div className="rounded-lg border border-[rgba(220,180,255,0.15)] bg-[rgba(20,50,80,0.2)] p-3 backdrop-blur-sm hover:border-[rgba(220,180,255,0.3)] transition-all">
            <div className="flex items-center gap-1 mb-1">
              <FlameIcon className="w-3 h-3 text-purple-300" />
              <div className="text-xs text-[rgba(200,240,255,0.6)]">Deep focus</div>
            </div>
            <div className="text-xl font-semibold text-[#E0E7FF] font-mono">
              <NumberAnimation value={sessionInsights.deepFocusSharePct} unit="%" delay={1.7} decimals={0} />
            </div>
            <div className="mt-1 text-xs text-slate-500 font-mono">Sessions lasting 2+ minutes</div>
          </div>
        </div>
        {advanced.bestDay && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.6 }}
            className="mt-4 rounded-lg border border-[rgba(220,180,255,0.2)] bg-[rgba(20,50,80,0.3)] p-3 backdrop-blur-sm flex items-center gap-3"
          >
            <AwardIcon className="w-5 h-5 text-yellow-300" />
            <div>
              <div className="text-xs text-[rgba(200,240,255,0.6)]">Best day</div>
              <div className="text-sm text-[#E0E7FF] font-mono">
                {formatShortDate(advanced.bestDay.localDate)} ·{" "}
                <NumberAnimation value={advanced.bestDay.avgWpm} decimals={1} delay={1.7} /> WPM ·{" "}
                <NumberAnimation value={advanced.bestDay.avgAccuracy} decimals={1} delay={1.8} />% ·{" "}
                <NumberAnimation value={advanced.bestDay.totalMinutes} delay={1.9} />m
              </div>
            </div>
          </motion.div>
        )}
      </motion.section>
    </motion.div>
  );
}
