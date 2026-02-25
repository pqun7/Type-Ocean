"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useSettings } from "@/features/settings/context";

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

export default function PvpResultsOverlay(props: {
  open: boolean;
  title?: string;
  placements: PvpResultsPlacement[];
  ratingChanges: PvpRatingChange[];
  chartData: PvpWpmPoint[];
  meUserId: string | null;
  opponentName: string;
  canRematch: boolean;
  rematchOfferFromUserId: string | null;
  rematchAcceptedUserIds: string[];
  rematchDeclinedReason: string | null;
  onRequestRematch: () => void;
  onAcceptRematch: () => void;
  onDeclineRematch: () => void;
  onFindNewOpponent: () => void;
}) {
  const { settings } = useSettings();

  const {
    open,
    title = "Match Results",
    placements,
    ratingChanges,
    chartData,
    meUserId,
    opponentName,
    canRematch,
    rematchOfferFromUserId,
    rematchAcceptedUserIds,
    rematchDeclinedReason,
    onRequestRematch,
    onAcceptRematch,
    onDeclineRematch,
    onFindNewOpponent,
  } = props;

  const chartConfig = React.useMemo(
    () =>
      ({
        meWpm: {
          label: "You",
          color: "hsl(var(--chart-1))",
        },
        opponentWpm: {
          label: opponentName || "Opponent",
          color: "hsl(var(--chart-3))",
        },
      }) satisfies ChartConfig,
    [opponentName]
  );

  if (!open) return null;

  const myChange = meUserId ? ratingChanges.find((r) => r.userId === meUserId) ?? null : null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[rgba(10,30,50,0.9)]/30 z-50 backdrop-blur-sm">
      <div className="max-w-6xl w-full mx-4 my-6">
        <Card className="bg-[rgba(15,40,70,0.5)] mt-8 rounded-xl border border-[rgba(200,240,255,0.1)]">
          <CardHeader className="px-6 pt-4 pb-2 border-b border-[rgba(200,240,255,0.1)]">
            <div>
              <h2 className="text-2xl font-bold text-blue-100">{title}</h2>
              <p className="text-sm text-[rgba(200,240,255,0.8)]">You vs {opponentName}</p>
            </div>
          </CardHeader>

          <CardContent className="p-4 space-y-4">
            {settings.showSessionChart ? (
              <div>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="fillMeWpm" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="rgba(160,220,255,0.6)" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="rgba(160,220,255,0.7)" stopOpacity={0.1} />
                      </linearGradient>
                      <linearGradient id="fillOpponentWpm" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="rgba(220,180,255,0.8)" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="rgba(220,180,255,0.8)" stopOpacity={0.1} />
                      </linearGradient>
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
                      content={
                        <ChartTooltipContent indicator="dot" labelClassName="text-[rgba(200,240,255,0.9)]" />
                      }
                    />
                    <Area
                      dataKey="meWpm"
                      type="natural"
                      fill="url(#fillMeWpm)"
                      stroke="rgba(160,220,255,1)"
                      strokeWidth={2}
                    />
                    <Area
                      dataKey="opponentWpm"
                      type="natural"
                      fill="url(#fillOpponentWpm)"
                      stroke="rgba(220,180,255,1)"
                      strokeWidth={2}
                    />
                    <ChartLegend content={<ChartLegendContent className="text-[rgba(200,240,255,0.9)]" />} />
                  </AreaChart>
                </ChartContainer>
              </div>
            ) : null}

            <div className="space-y-1 text-sm text-[#E0E7FF]/90">
              {placements.map((p) => (
                <div key={p.userId} className="flex items-center justify-between">
                  <span>
                    #{p.position} {p.username}
                  </span>
                  <span>
                    {p.wpm} WPM · {p.accuracy}% · {p.errors} err
                  </span>
                </div>
              ))}
            </div>

            {myChange ? (
              <div className="text-sm text-[#8A8FB5]">
                Rating: {myChange.before} → {myChange.after} ({myChange.delta >= 0 ? "+" : ""}
                {myChange.delta})
              </div>
            ) : null}

            {canRematch ? (
              <div className="space-y-2">
                {rematchDeclinedReason ? (
                  <div className="text-sm text-red-400">Rematch declined ({rematchDeclinedReason}).</div>
                ) : null}

                {rematchOfferFromUserId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm text-[#E0E7FF]/90">Opponent requested a rematch.</div>
                    <Button onClick={onAcceptRematch}>Accept</Button>
                    <Button variant="secondary" onClick={onDeclineRematch}>
                      Decline
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={onRequestRematch}>Rematch</Button>
                    {rematchAcceptedUserIds.length ? (
                      <div className="text-sm text-[#8A8FB5]">Accepted: {rematchAcceptedUserIds.length}/2</div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onFindNewOpponent}>
                Find new opponent
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
