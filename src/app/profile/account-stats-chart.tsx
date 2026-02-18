// src/app/profile/account-stats-chart
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

function formatTrendCategory(category: PerformanceTrendCategory) {
  switch (category) {
    case "ACCELERATING":
      return "🚀 Accelerating";
    case "IMPROVING":
      return "📈 Improving";
    case "DECLINING":
      return "📉 Declining";
    default:
      return "➖ Stable";
  }
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

    const mean = (values: number[]) =>
      values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

    const sum = (values: number[]) => values.reduce((sumVal, v) => sumVal + v, 0);

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

    const mean = (values: number[]) =>
      values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

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
    const consistencyScore = clamp(Math.round(stats.averageConsistency), 0, 100);
    const wpmScore = clamp(Math.round((stats.averageWPM / 120) * 100), 0, 100);
    const accuracyScore = clamp(Math.round(stats.averageAccuracy), 0, 100);
    const { cleanlinessScore } = intelligence.scores;
    const { stabilityScore: stabilityScoreRaw } = intelligence.trend;
    const stabilityScore = clamp(Math.round(stabilityScoreRaw), 0, 100);

    return [
      { metric: "Consistency", score: consistencyScore },
      { metric: "WPM score", score: wpmScore },
      { metric: "Accuracy", score: accuracyScore },
      { metric: "Cleanliness", score: cleanlinessScore },
      { metric: "Stability", score: stabilityScore },
    ];
  }, [
    intelligence.scores.cleanlinessScore,
    intelligence.trend.stabilityScore,
    stats.averageAccuracy,
    stats.averageConsistency,
    stats.averageWPM,
  ]);

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

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-100">Activity overview</div>
          <div className="text-xs text-slate-400">Session distribution and strength profile</div>
        </div>
        <div className="text-right text-xs text-slate-400">
          {totalSessions === 0 ? "No sessions yet" : `${totalSessions} recent sessions`}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="mb-2 text-xs text-slate-400">Sessions by text size</div>
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
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-slate-400">Performance intelligence</div>
              {/* <div className="mt-0.5 text-xs text-slate-500">WPM score is normalized (120 WPM = 100)</div> */}
              {/*
            //   <div className="mt-0.5 text-sm font-medium text-slate-100">
            //     {formatTrendCategory(intelligence.trend.category)}
            //   </div>
              <div className="mt-0.5 text-xs text-slate-500">
                Accelerating = improving faster · Improving = steady up · Stable = normal variation · Declining = trending down
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {intelligence.comparison.wpmDelta >= 0 ? "+" : ""}
                {intelligence.comparison.wpmDelta.toFixed(1)} WPM · {intelligence.comparison.accuracyDelta >= 0 ? "+" : ""}
                {intelligence.comparison.accuracyDelta.toFixed(1)}% (last 14d vs prev)
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                Cleanliness reflects mistakes + corrections per character typed (higher is better)
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                slope {intelligence.trend.slopePerDay >= 0 ? "+" : ""}
                {intelligence.trend.slopePerDay.toFixed(2)}/day · accel {intelligence.trend.accelerationPerDay2 >= 0 ? "+" : ""}
                {intelligence.trend.accelerationPerDay2.toFixed(2)}/day² · R² {intelligence.trend.r2.toFixed(2)} · stability {Math.round(intelligence.trend.stabilityScore)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">Index</div>
              <div className="text-lg font-semibold text-slate-100">{intelligence.scores.compositeIndex}</div>
            </div>
            */}
            </div>
          </div>
          <ChartContainer config={radarConfig} className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <PolarGrid className="opacity-35" gridType="circle" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: "rgba(226,232,240,0.85)", fontSize: 12 }} />
                <Radar
                  dataKey="score"
                  fill="var(--color-score)"
                  stroke="var(--color-score)"
                  fillOpacity={0.35}
                />
              </RadarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-slate-400">Recent vs previous</div>
            <div className="mt-0.5 text-sm font-medium text-slate-100">Last 14 active days vs the 14 before</div>
          </div>
          <div className="text-right text-xs text-slate-400">{recentVsPrevious14.pointsUsed} days used</div>
        </div>

        <div className="mb-3 rounded-md border border-white/10 bg-white/5 p-3">
          <ChartContainer config={recentVsPreviousChartConfig} className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={recentVsPrevious14.chartData} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} className="opacity-20" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={16}
                  tick={{ fill: "rgba(226,232,240,0.75)", fontSize: 12 }}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
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
          {!recentVsPrevious14.showPreviousSeries ? (
            <div className="mt-2 text-xs text-slate-500">Previous line appears once you have 28 active days</div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="rounded-md border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">Recent avg WPM</div>
            <div className="text-lg font-semibold text-slate-100">{recentVsPrevious14.recentAvgWpm.toFixed(1)}</div>
            <div className="mt-0.5 text-xs text-slate-500">{recentVsPrevious14.recentDaysUsed}/14 days</div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">Previous avg WPM</div>
            <div className="text-lg font-semibold text-slate-100">
              {recentVsPrevious14.hasPreviousWindow ? recentVsPrevious14.previousAvgWpm.toFixed(1) : "—"}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {recentVsPrevious14.hasPreviousWindow ? `${recentVsPrevious14.previousDaysUsed}/14 days` : "Need 28 active days"}
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">Δ WPM</div>
            <div className="text-lg font-semibold text-slate-100">
              {recentVsPrevious14.hasPreviousWindow
                ? `${recentVsPrevious14.deltaWpm >= 0 ? "+" : ""}${recentVsPrevious14.deltaWpm.toFixed(1)}`
                : "—"}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">Recent minus previous</div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">Recent sessions</div>
            <div className="text-lg font-semibold text-slate-100">{recentVsPrevious14.recentSessions}</div>
            <div className="mt-0.5 text-xs text-slate-500">Last 14 active days</div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">Recent minutes</div>
            <div className="text-lg font-semibold text-slate-100">{recentVsPrevious14.recentMinutes}</div>
            <div className="mt-0.5 text-xs text-slate-500">Time spent typing</div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-slate-400">Advanced analytics</div>
            <div className="mt-0.5 text-sm font-medium text-slate-100">Signals from your last 28 active days</div>
          </div>
          <div className="text-right text-xs text-slate-400">{advanced.pointsUsed} days used</div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">Trend confidence</div>
            <div className="text-lg font-semibold text-slate-100">{advanced.confidencePct}%</div>
            <div className="mt-0.5 text-xs text-slate-500">Based on R² (higher = clearer trend)</div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">Volatility</div>
            <div className="text-lg font-semibold text-slate-100">{advanced.volatilityCvPct}%</div>
            <div className="mt-0.5 text-xs text-slate-500">Lower = steadier performance</div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">Streaks</div>
            <div className="text-lg font-semibold text-slate-100">{advanced.streaks.current} / {advanced.streaks.longest}</div>
            <div className="mt-0.5 text-xs text-slate-500">Current / longest active-day streak</div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/5 p-3">
            <div className="text-xs text-slate-400">7-day shift</div>
            <div className="text-lg font-semibold text-slate-100">
              {advanced.wpmDelta7 >= 0 ? "+" : ""}{advanced.wpmDelta7.toFixed(1)} WPM
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {advanced.accDelta7 >= 0 ? "+" : ""}{advanced.accDelta7.toFixed(1)}% accuracy
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-white/10 bg-white/5 p-3">
          <div className="text-xs text-slate-400">Best day (quality index)</div>
          {advanced.bestDay ? (
            <div className="mt-0.5 text-sm text-slate-100">
              {formatShortDate(advanced.bestDay.localDate)} · {advanced.bestDay.avgWpm.toFixed(1)} WPM · {advanced.bestDay.avgAccuracy.toFixed(1)}% · {advanced.bestDay.totalMinutes}m · {advanced.bestDay.sessionsCount} sessions
            </div>
          ) : (
            <div className="mt-0.5 text-sm text-slate-500">Not enough recent activity yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
