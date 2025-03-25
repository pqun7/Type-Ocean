"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { motion, AnimatePresence } from "framer-motion"
import { NumberAnimation } from "../core/number-animation"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

const ResultsChart = ({
  wpm,
  accuracy,
  gameState,
  currentTime,
  wpmHistory,
  errorTimes,
}: {
  wpm: number;
  accuracy: number;
  gameState: "start" | "running" | "end";
  currentTime: number;
  wpmHistory: { time: number; wpm: number; prevWpm: number }[];
  errorTimes: number[];
}) => {
  const minutes = Math.floor(currentTime / 60)
  const seconds = currentTime % 60

  const chartData = wpmHistory.map(point => ({
    time: `${Math.floor(point.time / 1000)}s`,
    wpm: point.wpm,
    prevWpm: point.prevWpm,
    // accuracy: accuracy, // يمكن إضافة دقة لكل نقطة إذا لزم
  }));

  const ErrorMarks = () => (
    <>
      {errorTimes.map((time, idx) => (
        <circle
          key={idx}
          cx={`${(time / (currentTime * 1000)) * 100}%`}
          cy="50%"
          r="4"
          fill="red"
        />
      ))}
    </>
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
    accuracy: {
      label: "Accuracy",
      color: "hsl(var(--chart-2))",
    },
  } satisfies ChartConfig

  return (
    <AnimatePresence>
      {gameState === "end" && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-[rgba(10,30,50,0.9)]/30 z-50 backdrop-blur-sm"
        >
          <div className="relative max-w-9xl w-full mx-4 my-6">
            <div className="bg-[rgba(15,40,70,0.5)] rounded-xl border border-[rgba(200,240,255,0.1)] shadow-2xl overflow-hidden">
              <CardHeader className="px-6 pt-6 pb-4 border-b border-[rgba(200,240,255,0.1)]">
                <div className="space-y-1">
                  <CardTitle className="text-2xl text-[rgba(200,240,255,0.95)]">
                    Performance Chart
                  </CardTitle>
                  <CardDescription className="text-[rgba(200,240,255,0.7)]">
                    Your typing progress during the game
                  </CardDescription>
                </div>
              </CardHeader>
              
              <CardContent className="p-6">
                <div className="mb-6">
                  <ChartContainer
                    config={chartConfig}
                    className="h-[200px] w-full"
                  >
                    <AreaChart data={chartData}>
                    <g>{ErrorMarks()}</g>

                      <defs>
                        <linearGradient id="fillWpm" x1="0" y1="0" x2="0" y2="1">
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
                        <linearGradient id="fillPrevWpm" x1="0" y1="0" x2="0" y2="1">
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
                      <Area
                        dataKey="prevWpm"
                        type="natural"
                        fill="url(#fillPrevWpm)"
                        stroke="rgba(220,180,255,1)"
                        strokeWidth={2}
                      />
                     
                      <ChartLegend 
                        content={<ChartLegendContent 
                          className="text-[rgba(200,240,255,0.9)]"
                        />} 
                      />
                    </AreaChart>
                  </ChartContainer>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="text-center p-4 bg-[rgba(20,50,80,0.3)] rounded-lg border border-[rgba(160,220,255,0.1)]">
                    <p className="text-sm text-[rgba(200,240,255,0.7)] mb-2">WPM</p>
                    <p className="text-2xl font-bold text-[rgba(160,220,255,1)]">
                      <NumberAnimation
                        value={wpm}
                        color="rgba(160,220,255,1)"
                        delay={0.9}
                      />
                    </p>
                  </div>

                  <div className="text-center p-4 bg-[rgba(20,50,80,0.3)] rounded-lg border border-[rgba(80,210,150,0.1)]">
                    <p className="text-sm text-[rgba(200,240,255,0.7)] mb-2">Accuracy</p>
                    <p className="text-2xl font-bold text-[rgba(80,210,150,1)]">
                      <NumberAnimation
                        value={Math.min(100, Math.max(0, accuracy))}
                        unit="%"
                        color="rgba(80,210,150,1)"
                        delay={1.0}
                      />
                    </p>
                  </div>

                  <div className="text-center p-4 bg-[rgba(20,50,80,0.3)] rounded-lg border border-[rgba(80,210,150,0.1)]">
                    <p className="text-sm text-[rgba(200,240,255,0.7)] mb-2">Time</p>
                    <div className="text-2xl font-bold text-[rgba(80,210,150,1)]">
                      {minutes > 0 && (
                        <span className="inline-flex items-baseline">
                          <NumberAnimation
                            value={minutes}
                            color="rgba(80,210,150,1)"
                            delay={1.1}
                          />
                          <span className="text-sm ml-1">m</span>
                        </span>
                      )}
                      <span className="inline-flex items-baseline ml-1">
                        <NumberAnimation
                          value={seconds}
                          color="rgba(80,210,150,1)"
                          delay={1.1}
                        />
                        <span className="text-sm ml-1">s</span>
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>

              <motion.p
                animate={{ scale: [1, 1.03, 1] }}
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="text-center text-lg text-[rgba(160,220,255,1)] italic py-4 border-t border-[rgba(200,240,255,0.1)]"
              >
                Press Tab to restart
              </motion.p>
            </div>
          </div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default ResultsChart