"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NumberAnimation } from "@/components/core/number-animation-view";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  StopwatchIcon,
  LightningBoltIcon,
  Crosshair2Icon,
  CrossCircledIcon,
} from "@radix-ui/react-icons";
import KeyboardHeatmap, { type Language } from "@/components/TypingTest/KeyboardHeatmap";
import ResultsChart from "@/components/TypingTest/ResultsChart";
import type { KeyboardPerformanceData } from "@/components/TypingTest/utils/keyboardPerformance";
import { computeConsistency } from "@/features/typing/utils/consistency";

export const RESULTS_VIEW_MODE = {
  CHART: "chart",
  KEYBOARD: "keyboard",
} as const;

export type ResultsViewMode = (typeof RESULTS_VIEW_MODE)[keyof typeof RESULTS_VIEW_MODE];

interface ResultsProps {
  wpm: number;
  accuracy: number;
  gameState: "start" | "running" | "end";
  currentTime: number;
  wpmHistory: { time: number; wpm: number; prevWpm: number }[][];
  currentErrors: number;
  language: Language;
  performanceData?: KeyboardPerformanceData;
  viewMode?: ResultsViewMode;
}

export default function Results({
  wpm,
  accuracy,
  gameState,
  currentTime,
  wpmHistory,
  currentErrors,
  language,
  performanceData,
  viewMode = RESULTS_VIEW_MODE.KEYBOARD,
}: ResultsProps) {
  const minutes = Math.floor(currentTime / 60);
  const seconds = currentTime % 60;

  const sessionConsistency = React.useMemo(() => {
    const currentSession = wpmHistory[wpmHistory.length - 1] || [];
    return computeConsistency([currentSession]);
  }, [wpmHistory]);

  const insightPanel =
    viewMode === RESULTS_VIEW_MODE.CHART ? (
      <ResultsChart wpmHistory={wpmHistory} />
    ) : (
    //   <div className="rounded-xl border border-[rgba(200,240,255,0.1)] bg-[rgba(20,50,80,0.2)] p-3">
        <KeyboardHeatmap
          language={language}
          performanceData={performanceData}
          showLegend={false}
          size="medium"
        />
    //   </div>
    );

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
                <div className="mb-4">{insightPanel}</div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 }}
                    className="text-center p-5 bg-[rgba(20,50,80,0.3)] rounded-xl border border-[rgba(160,220,255,0.15)] backdrop-blur-sm hover:border-[rgba(160,220,255,0.3)] transition-all"
                  >
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <LightningBoltIcon className="w-5 h-5 text-cyan-300" />
                      <p className="text-sm text-[rgba(200,240,255,0.8)] uppercase tracking-wider">WPM</p>
                    </div>
                    <p className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400">
                      <NumberAnimation value={wpm} delay={0.9} />
                    </p>
                    <p className="text-xs mt-2 text-[rgba(200,240,255,0.6)]">Words Per Minute</p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8 }}
                    className="text-center p-5 bg-[rgba(20,50,80,0.3)] rounded-xl border border-[rgba(80,210,150,0.15)] backdrop-blur-sm hover:border-[rgba(80,210,150,0.3)] transition-all"
                  >
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <Crosshair2Icon className="w-5 h-5 text-green-300" />
                      <p className="text-sm text-[rgba(200,240,255,0.8)] uppercase tracking-wider">Accuracy</p>
                    </div>
                    <p className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-green-300 to-teal-400">
                      <NumberAnimation
                        value={Math.min(100, Math.max(0, accuracy))}
                        unit="%"
                        delay={1.0}
                      />
                    </p>
                    <p className="text-xs mt-2 text-[rgba(200,240,255,0.6)]">Typing Precision</p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 1.0 }}
                    className="text-center p-5 bg-[rgba(20,50,80,0.3)] rounded-xl border border-[rgba(220,180,255,0.15)] backdrop-blur-sm hover:border-[rgba(220,180,255,0.3)] transition-all"
                  >
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <StopwatchIcon className="w-5 h-5 text-blue-300" />
                      <p className="text-sm text-[rgba(200,240,255,0.8)] uppercase tracking-wider">Time</p>
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
                    <p className="text-xs mt-2 text-[rgba(200,240,255,0.6)]">Session Duration</p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.2 }}
                    className="text-center p-5 bg-[rgba(20,50,80,0.3)] rounded-xl border border-[rgba(255,160,120,0.15)] backdrop-blur-sm hover:border-[rgba(255,160,120,0.3)] transition-all"
                  >
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <CrossCircledIcon className="w-5 h-5 text-amber-300" />
                      <p className="text-sm text-[rgba(200,240,255,0.8)] uppercase tracking-wider">Errors</p>
                    </div>
                    <p className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-300 to-orange-400">
                      <NumberAnimation value={Math.max(0, currentErrors)} delay={1.3} />
                    </p>
                    <p className="text-xs mt-2 text-[rgba(200,240,255,0.6)]">Remaining at End</p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 1.4 }}
                    className="text-center p-5 bg-[rgba(20,50,80,0.3)] rounded-xl border border-[rgba(160,220,255,0.15)] backdrop-blur-sm hover:border-[rgba(160,220,255,0.3)] transition-all"
                  >
                    <p className="text-sm text-[rgba(200,240,255,0.8)] uppercase tracking-wider mb-3">Consistency</p>
                    <p className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400">
                      {sessionConsistency === null ? "—" : (
                        <NumberAnimation value={sessionConsistency} unit="%" delay={1.5} />
                      )}
                    </p>
                    <p className="text-xs mt-2 text-[rgba(200,240,255,0.6)]">Higher is better</p>
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
}
