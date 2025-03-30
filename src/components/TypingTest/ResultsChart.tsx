"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { NumberAnimation } from "../core/number-animation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

import {
  StopwatchIcon,
  LightningBoltIcon,
  Crosshair2Icon,
} from "@radix-ui/react-icons";

const ResultsChart = ({
  wpm,
  accuracy,
  gameState,
  currentTime,
  wpmHistory,
  currentErrors,
}: {
  wpm: number;
  accuracy: number;
  gameState: "start" | "running" | "end";
  currentTime: number;
  wpmHistory: { time: number; wpm: number; prevWpm: number }[][];
  currentErrors: number;
}) => {
  const minutes = Math.floor(currentTime / 60);
  const seconds = currentTime % 60;

  const currentSession = wpmHistory[wpmHistory.length - 1] || [];

  const chartData = currentSession.map((point) => {
    return {
      time: `${Math.floor(point.time / 1000)}s`,
      wpm: point.wpm,
      prevWpm: point.prevWpm,
    };
  });

  const showPrevWpm = chartData.some((point) => point.prevWpm !== 0);

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
    <AnimatePresence>
      {gameState === "end" && (
        <div className="fixed inset-0 flex items-center justify-center bg-[rgba(10,30,50,0.9)]/30 z-50 backdrop-blur-sm">
        <div className="max-w-9xl w-full mx-4 my-6">
          <Card className="bg-[rgba(15,40,70,0.5)] mt-8 rounded-xl border border-[rgba(200,240,255,0.1)]">
            <CardHeader className="px-6 pt-4 pb-2 border-b border-[rgba(200,240,255,0.1)]">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <h2 className="text-2xl font-bold text-blue-100">Performance Results</h2>
                <p className="text-sm text-[rgba(200,240,255,0.8)]">Typing analysis</p>
              </motion.div>
            </CardHeader>

            <CardContent className="p-4">
                <div className="mb-4">
                  <ChartContainer config={chartConfig} className="h-[180px] w-full">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient
                          id="fillWpm"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="rgba(160,220,255,0.6)"
                            stopOpacity={0.8}
                          />
                          <stop
                            offset="95%"
                            stopColor="rgba(160,220,255,0.7)"
                            stopOpacity={0.1}
                          />
                        </linearGradient>
                        {showPrevWpm && (
                          <linearGradient
                            id="fillPrevWpm"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="rgba(220,180,255,0.8)"
                              stopOpacity={0.8}
                            />
                            <stop
                              offset="95%"
                              stopColor="rgba(220,180,255,0.8)"
                              stopOpacity={0.1}
                            />
                          </linearGradient>
                        )}
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        stroke="rgba(200,240,255,0.1)"
                      />
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
                          <ChartTooltipContent
                            indicator="dot"
                            labelClassName="text-[rgba(200,240,255,0.9)]"
                          />
                        }
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
                      <ChartLegend
                        content={
                          <ChartLegendContent className="text-[rgba(200,240,255,0.9)]" />
                        }
                      />
                    </AreaChart>
                  </ChartContainer>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 }}
                    className="text-center p-5 bg-[rgba(20,50,80,0.3)] rounded-xl border border-[rgba(160,220,255,0.15)] backdrop-blur-sm hover:border-[rgba(160,220,255,0.3)] transition-all"
                  >
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <LightningBoltIcon className="w-5 h-5 text-cyan-300" />
                      <p className="text-sm text-[rgba(200,240,255,0.8)] uppercase tracking-wider">
                        WPM
                      </p>
                    </div>
                    <p className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400">
                      <NumberAnimation value={wpm} delay={0.9} />
                    </p>
                    <p className="text-xs mt-2 text-[rgba(200,240,255,0.6)]">
                      Words Per Minute
                    </p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8 }}
                    className="text-center p-5 bg-[rgba(20,50,80,0.3)] rounded-xl border border-[rgba(80,210,150,0.15)] backdrop-blur-sm hover:border-[rgba(80,210,150,0.3)] transition-all"
                  >
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <Crosshair2Icon className="w-5 h-5 text-green-300" />
                      <p className="text-sm text-[rgba(200,240,255,0.8)] uppercase tracking-wider">
                        Accuracy
                      </p>
                    </div>
                    <p className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-green-300 to-teal-400">
                      <NumberAnimation
                        value={Math.min(100, Math.max(0, accuracy))}
                        unit="%"
                        delay={1.0}
                      />
                    </p>
                    <p className="text-xs mt-2 text-[rgba(200,240,255,0.6)]">
                      Typing Precision
                    </p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 1.0 }}
                    className="text-center p-5 bg-[rgba(20,50,80,0.3)] rounded-xl border border-[rgba(220,180,255,0.15)] backdrop-blur-sm hover:border-[rgba(220,180,255,0.3)] transition-all"
                  >
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <StopwatchIcon className="w-5 h-5 text-blue-300" />
                      <p className="text-sm text-[rgba(200,240,255,0.8)] uppercase tracking-wider">
                        Time
                      </p>
                    </div>
                    <div className="text-3xl font-bold bg-clip-text text-transparent text-blue-300">
                      {minutes > 0 && (
                        <span className="inline-flex items-baseline">
                          <NumberAnimation value={minutes} delay={1.1} />
                          <span className="text-sm ml-1">m</span>
                        </span>
                      )}
                      <span className="inline-flex items-baseline ml-1">
                        <NumberAnimation value={seconds} delay={1.1} />
                        <span className="text-sm ml-1">s</span>
                      </span>
                    </div>
                    <p className="text-xs mt-2 text-[rgba(200,240,255,0.6)]">
                      Session Duration
                    </p>
                  </motion.div>
                </div>
                <motion.div className="text-center pt-4 border-t border-[rgba(200,240,255,0.1)]">
                  <p className="text-xs text-[rgba(160,220,255,0.9)]">
                    Press <kbd className="px-1.5 py-0.5 bg-[rgba(160,220,255,0.1)] rounded">Tab</kbd> to restart
                  </p>
                </motion.div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
};



export default ResultsChart;
