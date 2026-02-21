// src/components/ui/heatmap-calendar.tsx
"use client";

import * as React from "react";
import { motion, LayoutGroup } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NumberAnimation } from "@/components/core/number-animation-view";
import { Calendar, Flame, Trophy } from "lucide-react";

export type HeatmapDatum = {
  date: string | Date;
  value: number;
  meta?: unknown;
};

export type HeatmapCell = {
  date: Date;
  key: string;
  value: number;
  level: number;
  label: string;
  disabled: boolean;
  meta?: unknown;
};

export type LegendConfig = {
  show?: boolean;
  lessText?: React.ReactNode;
  moreText?: React.ReactNode;
  showArrow?: boolean;
  placement?: "right" | "bottom";
  direction?: "row" | "column";
  showText?: boolean;
  swatchSize?: number;
  swatchGap?: number;
  className?: string;
};

export type AxisLabelsConfig = {
  show?: boolean;
  showWeekdays?: boolean;
  showMonths?: boolean;
  weekdayIndices?: number[];
  monthFormat?: "short" | "long" | "numeric";
  minWeekSpacing?: number;
  className?: string;
};

export type HeatmapCalendarProps = {
  title?: string;
  data: HeatmapDatum[];
  rangeDays?: number;
  endDate?: Date;
  weekStartsOn?: 0 | 1;
  levelStrategy?: "quantile" | "fixedThresholds";
  fixedThresholds?: number[];
  responsive?: boolean;
  cellSize?: number;
  cellGap?: number;
  onCellClick?: (cell: HeatmapCell) => void;
  levelClassNames?: string[];
  palette?: string[];
  legend?: boolean | LegendConfig;
  axisLabels?: boolean | AxisLabelsConfig;
  renderLegend?: (args: {
    levelCount: number;
    levelClassNames: string[];
    palette?: string[];
    cellSize: number;
    cellGap: number;
  }) => React.ReactNode;
  renderTooltip?: (cell: HeatmapCell) => React.ReactNode;
  className?: string;
};

/* ---------- utilities ---------- */
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function toKey(d: Date) {
  const x = startOfDay(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function parseLocalDateKey(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, monthIndex, day);
  return Number.isNaN(d.getTime()) ? null : d;
}
function startOfWeek(d: Date, weekStartsOn: 0 | 1) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}
function buildQuantileThresholds(values: number[], positiveLevelCount: number) {
  if (positiveLevelCount <= 1 || values.length === 0) return [] as number[];
  const sorted = [...values].sort((a, b) => a - b);
  const thresholds: number[] = [];
  for (let i = 1; i < positiveLevelCount; i += 1) {
    const rank = (i / positiveLevelCount) * (sorted.length - 1);
    const lowIndex = Math.floor(rank);
    const highIndex = Math.ceil(rank);
    const ratio = rank - lowIndex;
    const low = sorted[lowIndex] ?? 0;
    const high = sorted[highIndex] ?? low;
    thresholds.push(low + (high - low) * ratio);
  }
  return thresholds;
}
function normalizeFixedThresholds(thresholds: number[] | undefined) {
  if (!Array.isArray(thresholds) || thresholds.length === 0) return [] as number[];
  return thresholds
    .filter((t) => typeof t === "number" && Number.isFinite(t) && t > 0)
    .slice()
    .sort((a, b) => a - b);
}
function getQuantileLevel(value: number, thresholds: number[]) {
  if (value <= 0) return 0;
  let level = 1;
  for (const threshold of thresholds) {
    if (value > threshold) level += 1;
    else break;
  }
  return level;
}
function getFixedThresholdLevel(value: number, thresholds: number[]) {
  if (value <= 0) return 0;
  let level = 1;
  for (const threshold of thresholds) {
    if (value > threshold) level += 1;
    else break;
  }
  return level;
}
function clampLevel(level: number, levelCount: number) {
  return Math.max(0, Math.min(levelCount - 1, level));
}
function bgStyleForLevel(level: number, palette?: string[]) {
  if (!palette?.length) return undefined;
  const idx = clampLevel(level, palette.length);
  return { backgroundColor: palette[idx] };
}
function formatMonth(d: Date, fmt: "short" | "long" | "numeric") {
  if (fmt === "numeric") {
    const yy = String(d.getFullYear()).slice(-2);
    return `${d.getMonth() + 1}/${yy}`;
  }
  return d.toLocaleDateString(undefined, { month: fmt });
}
function weekdayLabelForIndex(index: number, weekStartsOn: 0 | 1) {
  const actualDay = (weekStartsOn + index) % 7;
  const base = new Date(Date.UTC(2024, 0, 7 + actualDay));
  return base.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
}

/* ---------- main component ---------- */
export function HeatmapCalendar({
  title = "Activity",
  data,
  rangeDays = 365,
  endDate = new Date(),
  weekStartsOn = 0,
  levelStrategy = "quantile",
  fixedThresholds,
  responsive = false,
  cellSize = 12,
  cellGap = 3,
  onCellClick,
  levelClassNames,
  palette,
  legend = true,
  axisLabels = true,
  renderLegend,
  renderTooltip,
  className,
}: HeatmapCalendarProps) {
  // Default level classes (glass‑friendly)
  const levels = levelClassNames ?? [
    "bg-muted",
    "bg-primary/20",
    "bg-primary/35",
    "bg-primary/55",
    "bg-primary/75",
  ];
  const levelCount = palette?.length ? palette.length : levels.length;

  const legendCfg: LegendConfig =
    legend === true ? {} : legend === false ? { show: false } : legend;
  const axisCfg: AxisLabelsConfig =
    axisLabels === true ? {} : axisLabels === false ? { show: false } : axisLabels;

  const showAxis = axisCfg.show ?? true;
  const showWeekdays = axisCfg.showWeekdays ?? true;
  const showMonths = axisCfg.showMonths ?? true;
  const weekdayIndices = axisCfg.weekdayIndices ?? [0, 2, 4, 6];
  const monthFormat = axisCfg.monthFormat ?? "short";

  const end = React.useMemo(() => startOfDay(endDate), [endDate]);
  const start = React.useMemo(() => addDays(end, -(rangeDays - 1)), [end, rangeDays]);

  // Build value map
  const valueMap = React.useMemo(() => {
    const map = new Map<string, { value: number; meta?: unknown }>();
    for (const item of data) {
      const d =
        typeof item.date === "string"
          ? (parseLocalDateKey(item.date) ?? new Date(item.date))
          : item.date;
      const key = toKey(d);
      const prev = map.get(key);
      const nextVal = (prev?.value ?? 0) + (item.value ?? 0);
      map.set(key, { value: nextVal, meta: item.meta ?? prev?.meta });
    }
    return map;
  }, [data]);

  // Level thresholds
  const levelThresholds = React.useMemo(() => {
    if (levelStrategy === "fixedThresholds") {
      return normalizeFixedThresholds(fixedThresholds);
    }
    const positiveValues = Array.from(valueMap.values())
      .map((entry) => entry.value)
      .filter((value) => Number.isFinite(value) && value > 0);
    const positiveLevelCount = Math.max(1, levelCount - 1);
    return buildQuantileThresholds(positiveValues, positiveLevelCount);
  }, [fixedThresholds, levelCount, levelStrategy, valueMap]);

  const { columns, monthLabelRow } = React.useMemo(() => {
    const firstWeek = startOfWeek(start, weekStartsOn);
    const totalDays = Math.ceil((end.getTime() - firstWeek.getTime()) / 86400000) + 1;
    const weeks = Math.ceil(totalDays / 7);

    const cells: HeatmapCell[] = [];
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const date = addDays(firstWeek, w * 7 + d);
        const inRange = date >= start && date <= end;
        const key = toKey(date);
        const entry = inRange ? valueMap.get(key) : undefined;
        const value = entry?.value ?? 0;
        const meta = entry?.meta;
        const lvl = !inRange
          ? 0
          : levelStrategy === "fixedThresholds"
            ? getFixedThresholdLevel(value, levelThresholds)
            : getQuantileLevel(value, levelThresholds);

        cells.push({
          date,
          key,
          value,
          level: clampLevel(lvl, levelCount),
          disabled: !inRange,
          meta,
          label: date.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
        });
      }
    }

    const columns: HeatmapCell[][] = [];
    for (let i = 0; i < weeks; i++) {
      columns.push(cells.slice(i * 7, i * 7 + 7));
    }

    const monthLabelRow: (string | null)[] = [];
    if (showAxis && showMonths) {
      for (let col = 0; col < columns.length; col++) {
        let label: string | null = null;
        for (let row = 0; row < columns[col].length; row++) {
          const cell = columns[col][row];
          if (!cell.disabled && cell.date.getDate() === 1) {
            label = formatMonth(cell.date, monthFormat);
            break;
          }
        }
        monthLabelRow.push(label);
      }
    }

    return { columns, monthLabelRow };
  }, [
    end,
    levelCount,
    levelStrategy,
    levelThresholds,
    monthFormat,
    showAxis,
    showMonths,
    start,
    valueMap,
    weekStartsOn,
  ]);

  // Stats calculation
  const stats = React.useMemo(() => {
    let total = 0;
    const datesWithValue: Date[] = [];
    for (const [key, { value }] of valueMap.entries()) {
      if (value > 0) {
        total += value;
        const d = parseLocalDateKey(key);
        if (d) datesWithValue.push(d);
      }
    }
    datesWithValue.sort((a, b) => a.getTime() - b.getTime());

    let currentStreak = 0;
    let longestStreak = 0;
    if (datesWithValue.length > 0) {
      // current streak (use "today" when endDate is in the future)
      const today = startOfDay(new Date());
      const streakEnd = end.getTime() > today.getTime() ? today : end;

      let streak = 0;
      let checkDate = startOfDay(streakEnd);
      // Walk backwards until we hit a day with no activity.
      while (true) {
        const v = valueMap.get(toKey(checkDate))?.value ?? 0;
        if (!(v > 0)) break;
        streak += 1;
        checkDate = addDays(checkDate, -1);
      }
      currentStreak = streak;

      // longest streak
      let maxStreak = 1;
      let running = 1;
      for (let i = 1; i < datesWithValue.length; i++) {
        const prev = datesWithValue[i - 1];
        const curr = datesWithValue[i];
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
        if (diffDays === 1) {
          running++;
          maxStreak = Math.max(maxStreak, running);
        } else {
          running = 1;
        }
      }
      longestStreak = maxStreak;
    }
    return { total, currentStreak, longestStreak };
  }, [valueMap, end]);

  // Responsive sizing
  const weekdayLabelWidth = showAxis && showWeekdays ? 42 : 0;
  const calendarRef = React.useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!responsive) return;
    const el = calendarRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [responsive]);

  const effectiveSizing = React.useMemo(() => {
    if (!responsive || !containerWidth) {
      return { cellSize, cellGap };
    }
    const available = Math.max(0, containerWidth - weekdayLabelWidth);
    const sizeThatFits = Math.floor((available + cellGap) / Math.max(1, columns.length) - cellGap);
    const nextSize = Math.max(10, Math.min(cellSize, sizeThatFits));
    const factor = cellSize > 0 ? nextSize / cellSize : 1;
    const nextGap = Math.max(2, Math.min(cellGap, Math.round(cellGap * factor)));
    return { cellSize: nextSize, cellGap: nextGap };
  }, [responsive, containerWidth, weekdayLabelWidth, cellSize, cellGap, columns.length]);

  // Legend UI
  const showLegend = legendCfg.show ?? true;
  const placement = legendCfg.placement ?? "bottom";
  const direction = legendCfg.direction ?? "row";
  const showText = legendCfg.showText ?? true;
  const showArrow = legendCfg.showArrow ?? true;
  const lessText = legendCfg.lessText ?? "Less";
  const moreText = legendCfg.moreText ?? "More";
  const swatchSize =
    legendCfg.swatchSize ?? (placement === "bottom" ? Math.max(8, Math.min(10, cellSize)) : cellSize);
  const swatchGap = legendCfg.swatchGap ?? (placement === "bottom" ? Math.max(2, Math.min(3, cellGap)) : cellGap);

  const LegendUI = renderLegend ? (
    renderLegend({
      levelCount,
      levelClassNames: levels,
      palette,
      cellSize,
      cellGap,
    })
  ) : !showLegend ? null : (
    <motion.div
      initial={placement === "bottom" ? { opacity: 0, y: 6 } : { opacity: 0, x: 10 }}
      animate={placement === "bottom" ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }}
      transition={{ delay: 0.6 }}
      className={cn(
        placement === "bottom" ? "w-full flex flex-col items-center justify-center" : "min-w-35",
        legendCfg.className
      )}
    >
      {showText ? (
        <div className={cn("text-[10px] text-[rgba(200,240,255,0.8)]", placement === "bottom" ? "mb-1" : "mb-2")}>
          {lessText} {showArrow ? <span aria-hidden>→</span> : null} {moreText}
        </div>
      ) : null}
      <div
        className={cn(
          "flex items-center justify-center",
          direction === "row" ? "flex-row" : "flex-col"
        )}
        style={{ gap: `${swatchGap}px` }}
      >
        {Array.from({ length: levelCount }).map((_, i) => {
          const cls = levels[clampLevel(i, levels.length)];
          return (
            <div
              key={i}
              className={cn("rounded-[3px]", !palette?.length && cls)}
              style={{
                width: swatchSize,
                height: swatchSize,
                ...(bgStyleForLevel(i, palette) ?? {}),
              }}
              aria-hidden="true"
            />
          );
        })}
      </div>
    </motion.div>
  );

  // Tooltip renderer
  const tooltipNode = (cell: HeatmapCell) => {
    if (renderTooltip) return renderTooltip(cell);
    if (cell.disabled) return <span>Outside range</span>;
    const unit = cell.value === 1 ? "event" : "events";
    return (
      <div className="text-sm">
        <div className="font-medium">
          {cell.value} {unit}
        </div>
        <div className="text-[rgba(200,240,255,0.6)]">{cell.label}</div>
      </div>
    );
  };

  const { cellSize: computedCellSize, cellGap: computedCellGap } = effectiveSizing;

  const scrollContainerClass = responsive ? "overflow-hidden" : "overflow-x-auto overflow-y-hidden";

  return (
    <LayoutGroup>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full"
      >
        <Card className={cn("border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl hover:border-[rgba(160,220,255,0.3)] transition-all", className)}>
          <CardHeader className="pb-3">
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
            >
              <CardTitle className="text-lg text-[#E0E7FF]">{title}</CardTitle>
            </motion.div>
          </CardHeader>

          <CardContent>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
              {[
                { icon: Calendar, label: "Total", value: stats.total, color: "from-cyan-300 to-blue-400", iconColor: "text-cyan-300" },
                { icon: Flame, label: "Current Streak", value: stats.currentStreak, color: "from-orange-300 to-red-400", iconColor: "text-orange-300" },
                { icon: Trophy, label: "Longest Streak", value: stats.longestStreak, color: "from-yellow-300 to-amber-400", iconColor: "text-yellow-300" },
              ].map((stat, idx) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + idx * 0.1 }}
                  className="text-center p-4 bg-[rgba(20,50,80,0.3)] rounded-xl border border-[rgba(160,220,255,0.15)] backdrop-blur-sm hover:border-[rgba(160,220,255,0.3)] transition-all"
                >
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <stat.icon className={cn("w-4 h-4", stat.iconColor)} />
                    <p className="text-xs text-[rgba(200,240,255,0.8)] uppercase tracking-wider">
                      {stat.label}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "text-2xl font-bold bg-clip-text text-transparent",
                      `bg-gradient-to-r ${stat.color}`
                    )}
                  >
                    <NumberAnimation value={stat.value} delay={0.3 + idx * 0.1} />
                  </p>
                </motion.div>
              ))}
            </div>

            {/* Main heatmap with tooltips */}
            <TooltipProvider delayDuration={80}>
              <div className={cn("flex w-full gap-4", placement === "bottom" && "flex-col", scrollContainerClass)}>
                <div ref={calendarRef} className={cn("min-w-0 w-full", axisCfg.className)} dir="ltr">
                  {/* Month labels */}
                  {showAxis && showMonths ? (
                    <div className="flex" style={{ paddingLeft: weekdayLabelWidth, marginBottom: 2 }}>
                      {monthLabelRow.map((label, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-center text-xs text-[rgba(200,240,255,0.6)]"
                          style={{
                            width: computedCellSize,
                            height: 18,
                            marginRight: i < monthLabelRow.length - 1 ? computedCellGap : 0,
                            fontWeight: label ? 600 : undefined,
                            opacity: label ? 1 : 0,
                          }}
                        >
                          {label || ""}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex">
                    {/* Weekday labels */}
                    {showAxis && showWeekdays ? (
                      <div
                        className="mr-2 flex flex-col"
                        style={{ gap: `${computedCellGap}px` }}
                        aria-hidden="true"
                      >
                        {Array.from({ length: 7 }).map((_, rowIdx) => (
                          <div
                            key={rowIdx}
                            className="flex items-center justify-end text-xs text-[rgba(200,240,255,0.6)]"
                            style={{ width: 40, height: computedCellSize }}
                          >
                            {weekdayIndices.includes(rowIdx)
                              ? weekdayLabelForIndex(rowIdx, weekStartsOn)
                              : ""}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {/* Heatmap grid */}
                    <div
                      className="flex"
                      style={{ gap: `${computedCellGap}px` }}
                      role="grid"
                      aria-label="Heatmap calendar"
                    >
                      {columns.map((col, i) => (
                        <div
                          key={i}
                          className="flex flex-col"
                          style={{ gap: `${computedCellGap}px` }}
                          role="rowgroup"
                        >
                          {col.map((cell) => {
                            const cls = levels[clampLevel(cell.level, levels.length)];
                            const isMonthStart = !cell.disabled && cell.date.getDate() === 1;
                            const content = tooltipNode(cell);

                            const button = (
                              <button
                                type="button"
                                key={`${cell.key}-${i}`}
                                disabled={cell.disabled}
                                onClick={() => !cell.disabled && onCellClick?.(cell)}
                                className={cn(
                                  "rounded-[3px] border border-[rgba(160,220,255,0.1)] outline-none ring-offset-background transition-all duration-200",
                                  "hover:border-[rgba(160,220,255,0.6)] hover:z-10 hover:shadow-lg",
                                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                  !palette?.length && cls,
                                  isMonthStart && "border-primary/60",
                                  cell.disabled && "cursor-default opacity-30 pointer-events-none"
                                )}
                                style={{
                                  width: computedCellSize,
                                  height: computedCellSize,
                                  ...(bgStyleForLevel(cell.level, palette) ?? {}),
                                }}
                                aria-label={
                                  cell.disabled ? "Outside range" : `${cell.label}: ${cell.value}`
                                }
                                role="gridcell"
                              />
                            );

                            if (content == null) {
                              return button;
                            }

                            return (
                              <Tooltip key={`${cell.key}-${i}`}>
                                <TooltipTrigger asChild>{button}</TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  className="bg-[rgba(20,50,80,0.9)] backdrop-blur-md border border-[rgba(160,220,255,0.3)] text-white"
                                >
                                  {content}
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Legend */}
                {LegendUI}
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>
      </motion.div>
    </LayoutGroup>
  );
}