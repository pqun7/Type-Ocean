"use client";

import { useSettings } from "@/features/settings/context";
import KeyboardHeatmap, { type PerformanceData, type Size } from "./KeyboardHeatmap";
import type { Language } from "./KeyboardHeatmap";

interface KeyboardHeatmapWithSettingsProps {
  performanceData?: PerformanceData;
  showLegend?: boolean;
  className?: string;
  size?: Size;
}

export default function KeyboardHeatmapWithSettings({
  performanceData,
  showLegend,
  className,
  size,
}: KeyboardHeatmapWithSettingsProps) {
  const { settings } = useSettings();
  const language = settings.typingLanguage as Language;

  return (
    <KeyboardHeatmap
      language={language}
      performanceData={performanceData}
      showLegend={showLegend}
      className={className}
      size={size}
    />
  );
}
