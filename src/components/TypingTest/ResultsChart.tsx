"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

export interface ResultsChartProps {
  wpmHistory: { time: number; wpm: number; prevWpm: number }[][];
  className?: string;
}

export default function ResultsChart({ wpmHistory, className = "" }: ResultsChartProps) {
  const chartData = React.useMemo(() => {
    const currentSession = wpmHistory[wpmHistory.length - 1] || [];
    return currentSession.map((point) => ({
      time: `${Math.floor(point.time / 1000)}s`,
      wpm: point.wpm,
      prevWpm: point.prevWpm,
    }));
  }, [wpmHistory]);

  const showPrevWpm = React.useMemo(
    () => chartData.some((point) => point.prevWpm !== 0),
    [chartData]
  );

  const chartConfig = {
    wpm: {
      label: "Current WPM",
      color: "hsl(var(--chart-1))",
    },
    prevWpm: {
      label: "Previous WPM",
      color: "hsl(var(--chart-3))",
    },
  } satisfies ChartConfig;

  return (
    <div className={className}>
      <ChartContainer config={chartConfig} className="h-[180px] w-full">
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="fillWpm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="rgba(160,220,255,0.6)" stopOpacity={0.8} />
              <stop offset="95%" stopColor="rgba(160,220,255,0.7)" stopOpacity={0.1} />
            </linearGradient>
            {showPrevWpm && (
              <linearGradient id="fillPrevWpm" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="rgba(220,180,255,0.8)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="rgba(220,180,255,0.8)" stopOpacity={0.1} />
              </linearGradient>
            )}
          </defs>
          <CartesianGrid vertical={false} stroke="rgba(200,240,255,0.1)" />
          <XAxis
            dataKey="time"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
            stroke="rgba(200,240,255,0.6)"
          />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent indicator="dot" labelClassName="text-[rgba(200,240,255,0.9)]" />}
          />
          <Area
            dataKey="wpm"
            type="natural"
            fill="url(#fillWpm)"
            stroke="rgba(160,220,255,1)"
            strokeWidth={2}
          />
          {showPrevWpm && (
            <Area
              dataKey="prevWpm"
              type="natural"
              fill="url(#fillPrevWpm)"
              stroke="rgba(220,180,255,1)"
              strokeWidth={2}
            />
          )}
          <ChartLegend content={<ChartLegendContent className="text-[rgba(200,240,255,0.9)]" />} />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
