"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

type LongTermStats = {
  totalSessions: number;
  totalTimeTyped: number;
  totalWordsTyped: number;
  totalCharactersTyped: number;
  totalMistakes: number;
  totalCorrections: number;
  averageWPM: number;
  averageAccuracy: number;
  bestWPM: number;
  bestWPMDate: string | null;
  bestAccuracy: number;
  bestAccuracyDate: string | null;
  lastUpdated: string;
};

export default function AccountStatsChart({ stats }: { stats: LongTermStats }) {
  const data = React.useMemo(
    () => [
      { key: "words", label: "Words", value: stats.totalWordsTyped },
      { key: "chars", label: "Characters", value: stats.totalCharactersTyped },
    ],
    [stats]
  );

  const chartConfig = {
    value: {
      label: "Total",
      color: "hsl(var(--chart-1))",
    },
  } satisfies ChartConfig;

  const isEmpty = stats.totalSessions === 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-100">Activity overview</div>
          <div className="text-xs text-slate-400">Totals across all sessions</div>
        </div>
        <div className="text-right text-xs text-slate-400">
          {isEmpty ? "No sessions yet" : `Updated ${new Date(stats.lastUpdated).toLocaleString()}`}
        </div>
      </div>

      <ChartContainer config={chartConfig} className="h-[220px] w-full">
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={12}
            stroke="rgba(226,232,240,0.7)"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            stroke="rgba(226,232,240,0.5)"
            width={38}
          />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent indicator="dot" labelClassName="text-slate-100" />}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="var(--color-value)" />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
