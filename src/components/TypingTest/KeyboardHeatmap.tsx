"use client";

import React, { useMemo } from "react";

// ---------- Types ----------
export type KeyId = string;
export type KeyType = "letter" | "symbol" | "modifier" | "space";

export interface KeyData {
  id: KeyId;
  label: string | React.ReactNode;
  span: number;
  ariaLabel?: string;
  keyType?: KeyType;
}

export interface RowData {
  keys: KeyData[];
}

export type Layout = RowData[];

export interface PerformanceData {
  [keyId: string]: { correct: number; error: number } | undefined;
}

export type Language = "en" | "ar";
export type Size = "small" | "medium" | "large";

export interface KeyboardHeatmapProps {
  language: Language;
  performanceData?: PerformanceData;
  showLegend?: boolean;
  className?: string;
  size?: Size;
}

// ---------- Static Styles (module-level, no per-render allocation) ----------
const GLASS_BG = "rgba(20, 50, 80, 0.3)";
const KEY_BASE_COLOR = "rgba(40, 70, 100, 0.4)";
const MODIFIER_COLOR = "rgba(30, 50, 70, 0.6)";
const SPACE_COLOR = "rgba(60, 100, 140, 0.3)";
const TEXT_COLORS = {
  light: "#E0E7FF",
  dark: "#ffffff",
};

const CONTAINER_STYLE: React.CSSProperties = {
  background: GLASS_BG,
  backdropFilter: "blur(30px)",
  WebkitBackdropFilter: "blur(30px)",
  borderRadius: "28px",
  padding: "1.25rem",
  border: "1px solid rgba(160, 220, 255, 0.15)",
  boxShadow: "none",
};

const GAP_MAP: Record<Size, { row: string; col: string }> = {
  small: { row: "0.2rem", col: "0.24rem" },
  medium: { row: "0.32rem", col: "0.42rem" },
  large: { row: "0.5rem", col: "0.6rem" },
};

const HEIGHT_MAP: Record<Size, string> = {
  small: "2.8rem",
  medium: "3.7rem",
  large: "4.6rem",
};

const FONT_SIZE_MAP: Record<Size, Record<KeyType, string>> = {
  small: { letter: "0.82rem", symbol: "0.74rem", modifier: "0.65rem", space: "0.65rem" },
  medium: { letter: "1.08rem", symbol: "0.98rem", modifier: "0.82rem", space: "0.82rem" },
  large: { letter: "1.44rem", symbol: "1.28rem", modifier: "1.08rem", space: "1.08rem" },
};

const LINE_HEIGHT_MAP: Record<Size, Record<KeyType, string>> = {
  small: { letter: "1.2", symbol: "1.2", modifier: "1.2", space: "1.2" },
  medium: { letter: "1.3", symbol: "1.3", modifier: "1.3", space: "1.3" },
  large: { letter: "1.4", symbol: "1.4", modifier: "1.4", space: "1.4" },
};

// ---------- Precomputed Layout Data (Static) ----------
interface EnhancedKey {
  id: KeyId;
  label: string | React.ReactNode;
  ariaLabel?: string;
  spanUnits: number;
  isSpacer: boolean;
  keyType: KeyType;
  textAlign: "left" | "center" | "right";
  dualSymbolParts: [string, string] | null;
  defaultColors: { bg: string; text: string };
}

interface EnhancedRow {
  keys: EnhancedKey[];
  totalUnits: number;
}

type EnhancedLayout = EnhancedRow[];

const ENGLISH_LAYOUT: Layout = [
  {
    keys: [
      { id: "Backtick", label: "` ~", span: 1, keyType: "symbol" },
      { id: "1", label: "1", span: 1, keyType: "symbol" },
      { id: "2", label: "2", span: 1, keyType: "symbol" },
      { id: "3", label: "3", span: 1, keyType: "symbol" },
      { id: "4", label: "4", span: 1, keyType: "symbol" },
      { id: "5", label: "5", span: 1, keyType: "symbol" },
      { id: "6", label: "6", span: 1, keyType: "symbol" },
      { id: "7", label: "7", span: 1, keyType: "symbol" },
      { id: "8", label: "8", span: 1, keyType: "symbol" },
      { id: "9", label: "9", span: 1, keyType: "symbol" },
      { id: "0", label: "0", span: 1, keyType: "symbol" },
      { id: "Delete", label: "Delete", span: 2, ariaLabel: "Delete", keyType: "modifier" },
    ],
  },
  {
    keys: [
      { id: "Tab", label: "Tab", span: 2, ariaLabel: "Tab", keyType: "modifier" },
      { id: "q", label: "Q", span: 1, keyType: "letter" },
      { id: "w", label: "W", span: 1, keyType: "letter" },
      { id: "e", label: "E", span: 1, keyType: "letter" },
      { id: "r", label: "R", span: 1, keyType: "letter" },
      { id: "t", label: "T", span: 1, keyType: "letter" },
      { id: "y", label: "Y", span: 1, keyType: "letter" },
      { id: "u", label: "U", span: 1, keyType: "letter" },
      { id: "i", label: "I", span: 1, keyType: "letter" },
      { id: "o", label: "O", span: 1, keyType: "letter" },
      { id: "p", label: "P", span: 1, keyType: "letter" },
      { id: "BracketLeft", label: "{ [", span: 1, keyType: "symbol" },
      { id: "BracketRight", label: "} ]", span: 1, keyType: "symbol" },
      { id: "Backslash", label: "\\ |", span: 1, keyType: "symbol" },
    ],
  },
  {
    keys: [
      { id: "CapsLock", label: "Caps Lock", span: 2.5, ariaLabel: "Caps Lock", keyType: "modifier" },
      { id: "a", label: "A", span: 1, keyType: "letter" },
      { id: "s", label: "S", span: 1, keyType: "letter" },
      { id: "d", label: "D", span: 1, keyType: "letter" },
      { id: "f", label: "F", span: 1, keyType: "letter" },
      { id: "g", label: "G", span: 1, keyType: "letter" },
      { id: "h", label: "H", span: 1, keyType: "letter" },
      { id: "j", label: "J", span: 1, keyType: "letter" },
      { id: "k", label: "K", span: 1, keyType: "letter" },
      { id: "l", label: "L", span: 1, keyType: "letter" },
      { id: "Semicolon", label: ": ;", span: 1, keyType: "symbol" },
      { id: "Quote", label: '" \'', span: 1, keyType: "symbol" },
      { id: "Enter", label: "Enter", span: 2, ariaLabel: "Enter", keyType: "modifier" },
    ],
  },
  {
    keys: [
      { id: "ShiftLeft", label: "Shift", span: 3, ariaLabel: "Shift", keyType: "modifier" },
      { id: "z", label: "Z", span: 1, keyType: "letter" },
      { id: "x", label: "X", span: 1, keyType: "letter" },
      { id: "c", label: "C", span: 1, keyType: "letter" },
      { id: "v", label: "V", span: 1, keyType: "letter" },
      { id: "b", label: "B", span: 1, keyType: "letter" },
      { id: "n", label: "N", span: 1, keyType: "letter" },
      { id: "m", label: "M", span: 1, keyType: "letter" },
      { id: "Comma", label: "< ,", span: 1, keyType: "symbol" },
      { id: "Period", label: "> .", span: 1, keyType: "symbol" },
      { id: "Slash", label: "/ ?", span: 1, keyType: "symbol" },
      { id: "ShiftRight", label: "Shift", span: 3, ariaLabel: "Shift", keyType: "modifier" },
    ],
  },
  {
    keys: [
      { id: "SpaceLeftPad", label: "", span: 3, ariaLabel: "Spacer", keyType: "modifier" },
      { id: "Space", label: "space", span: 10, ariaLabel: "Space", keyType: "space" },
      { id: "SpaceRightPad", label: "", span: 3, ariaLabel: "Spacer", keyType: "modifier" },
    ],
  },
];

const ARABIC_LAYOUT: Layout = [
  {
    keys: [
      { id: "Backtick", label: "ذ", span: 1, keyType: "symbol" },
      { id: "1", label: "١", span: 1, keyType: "symbol" },
      { id: "2", label: "٢", span: 1, keyType: "symbol" },
      { id: "3", label: "٣", span: 1, keyType: "symbol" },
      { id: "4", label: "٤", span: 1, keyType: "symbol" },
      { id: "5", label: "٥", span: 1, keyType: "symbol" },
      { id: "6", label: "٦", span: 1, keyType: "symbol" },
      { id: "7", label: "٧", span: 1, keyType: "symbol" },
      { id: "8", label: "٨", span: 1, keyType: "symbol" },
      { id: "9", label: "٩", span: 1, keyType: "symbol" },
      { id: "0", label: "٠", span: 1, keyType: "symbol" },
      { id: "Delete", label: "حذف", span: 2, ariaLabel: "Delete", keyType: "modifier" },
    ],
  },
  {
    keys: [
      { id: "Tab", label: "Tab", span: 2, ariaLabel: "Tab", keyType: "modifier" },
      { id: "q", label: "ض", span: 1, keyType: "letter" },
      { id: "w", label: "ص", span: 1, keyType: "letter" },
      { id: "e", label: "ث", span: 1, keyType: "letter" },
      { id: "r", label: "ق", span: 1, keyType: "letter" },
      { id: "t", label: "ف", span: 1, keyType: "letter" },
      { id: "y", label: "غ", span: 1, keyType: "letter" },
      { id: "u", label: "ع", span: 1, keyType: "letter" },
      { id: "i", label: "ه", span: 1, keyType: "letter" },
      { id: "o", label: "خ", span: 1, keyType: "letter" },
      { id: "p", label: "ح", span: 1, keyType: "letter" },
      { id: "BracketLeft", label: "ج", span: 1, keyType: "symbol" },
      { id: "BracketRight", label: "د", span: 1, keyType: "symbol" },
      { id: "Backslash", label: "\\", span: 1, keyType: "symbol" },
    ],
  },
  {
    keys: [
      { id: "CapsLock", label: "Caps Lock", span: 2.5, ariaLabel: "Caps Lock", keyType: "modifier" },
      { id: "a", label: "ش", span: 1, keyType: "letter" },
      { id: "s", label: "س", span: 1, keyType: "letter" },
      { id: "d", label: "ي", span: 1, keyType: "letter" },
      { id: "f", label: "ب", span: 1, keyType: "letter" },
      { id: "g", label: "ل", span: 1, keyType: "letter" },
      { id: "h", label: "ا", span: 1, keyType: "letter" },
      { id: "j", label: "ت", span: 1, keyType: "letter" },
      { id: "k", label: "ن", span: 1, keyType: "letter" },
      { id: "l", label: "م", span: 1, keyType: "letter" },
      { id: "Semicolon", label: "ك", span: 1, keyType: "symbol" },
      { id: "Quote", label: "ط", span: 1, keyType: "symbol" },
      { id: "Enter", label: "إدخال", span: 2, ariaLabel: "Enter", keyType: "modifier" },
    ],
  },
  {
    keys: [
      { id: "ShiftLeft", label: "Shift", span: 3, ariaLabel: "Shift", keyType: "modifier" },
      { id: "z", label: "ئ", span: 1, keyType: "letter" },
      { id: "x", label: "ء", span: 1, keyType: "letter" },
      { id: "c", label: "ؤ", span: 1, keyType: "letter" },
      { id: "v", label: "ر", span: 1, keyType: "letter" },
      { id: "b", label: "لا", span: 1, keyType: "letter" },
      { id: "n", label: "ى", span: 1, keyType: "letter" },
      { id: "m", label: "ة", span: 1, keyType: "letter" },
      { id: "Comma", label: "و", span: 1, keyType: "symbol" },
      { id: "Period", label: "ز", span: 1, keyType: "symbol" },
      { id: "Slash", label: "ظ", span: 1, keyType: "symbol" },
      { id: "ShiftRight", label: "Shift", span: 3, ariaLabel: "Shift", keyType: "modifier" },
    ],
  },
  {
    keys: [
      { id: "SpaceLeftPad", label: "", span: 3, ariaLabel: "Spacer", keyType: "modifier" },
      { id: "Space", label: "مسافة", span: 10, ariaLabel: "Space", keyType: "space" },
      { id: "SpaceRightPad", label: "", span: 3, ariaLabel: "Spacer", keyType: "modifier" },
    ],
  },
];

const getDefaultColors = (isSpacer: boolean, keyType: KeyType): { bg: string; text: string } => {
  if (isSpacer) {
    return { bg: "transparent", text: TEXT_COLORS.light };
  }

  if (keyType === "modifier") {
    return { bg: MODIFIER_COLOR, text: TEXT_COLORS.light };
  }

  if (keyType === "space") {
    return { bg: SPACE_COLOR, text: TEXT_COLORS.dark };
  }

  return { bg: KEY_BASE_COLOR, text: TEXT_COLORS.light };
};

const createEnhancedLayout = (rawLayout: Layout): EnhancedLayout => {
  return rawLayout.map((row) => {
    let totalUnits = 0;
    const enhancedKeys = row.keys.map((key) => {
      const spanUnits = Math.max(1, Math.round(key.span * 2));
      totalUnits += spanUnits;
      const isSpacer = key.id === "SpaceLeftPad" || key.id === "SpaceRightPad";
      const keyType = key.keyType ?? "letter";
      const defaultColors = getDefaultColors(isSpacer, keyType);
      let textAlign: "left" | "center" | "right" = "center";
      if (keyType === "modifier") {
        if (key.id === "Tab" || key.id === "CapsLock" || key.id.includes("ShiftLeft")) textAlign = "left";
        else if (key.id === "Delete" || key.id === "Enter" || key.id.includes("ShiftRight")) textAlign = "right";
      }
      let dualSymbolParts: [string, string] | null = null;
      if (keyType === "symbol" && typeof key.label === "string") {
        const parts = key.label.split(" ").filter(Boolean);
        if (parts.length === 2) dualSymbolParts = parts as [string, string];
      }
      return {
        id: key.id,
        label: key.label,
        ariaLabel: key.ariaLabel,
        spanUnits,
        isSpacer,
        keyType,
        textAlign,
        dualSymbolParts,
        defaultColors,
      };
    });
    return { keys: enhancedKeys, totalUnits };
  });
};

const ENHANCED_LAYOUTS: Record<Language, EnhancedLayout> = {
  en: createEnhancedLayout(ENGLISH_LAYOUT),
  ar: createEnhancedLayout(ARABIC_LAYOUT),
};

// ---------- Heatmap Color Map (Memoized, using for...in) ----------
type HeatmapColors = { bg: string; text: string };

const useHeatmapColorMap = (
  performanceData?: PerformanceData
): Partial<Record<KeyId, HeatmapColors>> => {
  return useMemo(() => {
    const colorMap: Partial<Record<KeyId, HeatmapColors>> = Object.create(null);

    if (!performanceData) return colorMap;

    const netScores: Record<string, number> = Object.create(null);
    let maxAbs = 0;

    // Use for...in to avoid allocations from Object.entries
    for (const keyId in performanceData) {
      if (!Object.prototype.hasOwnProperty.call(performanceData, keyId)) continue;
      const value = performanceData[keyId];
      if (value) {
        const net = value.correct - value.error;
        netScores[keyId] = net;
        const absNet = net < 0 ? -net : net;
        if (absNet > maxAbs) maxAbs = absNet;
      }
    }

    if (maxAbs === 0) return colorMap;

    const scale = (absNet: number) => Math.sqrt(absNet / maxAbs);

    for (const keyId in netScores) {
      if (!Object.prototype.hasOwnProperty.call(netScores, keyId)) continue;
      const net = netScores[keyId];
      const absNet = net < 0 ? -net : net;
      const intensity = scale(absNet);
      const baseLightness = 70;
      const lightness = baseLightness - intensity * 25;
      const alpha = 0.7;
      let bg: string;
      if (net > 0) {
        bg = `oklch(${lightness}% 0.12 165 / ${alpha})`;
      } else if (net < 0) {
        bg = `oklch(${lightness}% 0.12 30 / ${alpha})`;
      } else {
        bg = KEY_BASE_COLOR;
      }
      colorMap[keyId] = { bg, text: TEXT_COLORS.light };
    }
    return colorMap;
  }, [performanceData]);
};

// ---------- Key Component (Memoized, uses precomputed metadata) ----------
interface KeyProps {
  enhancedKey: EnhancedKey;
  bgColor: string;
  textColor: string;
  size: Size;
}

const Key: React.FC<KeyProps> = React.memo(({ enhancedKey, bgColor, textColor, size }) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, label, ariaLabel, spanUnits, isSpacer, keyType, textAlign, dualSymbolParts } = enhancedKey;

  const height = HEIGHT_MAP[size];
  const fontSize = FONT_SIZE_MAP[size][keyType];
  const lineHeight = LINE_HEIGHT_MAP[size][keyType];
  const letterSpacing = keyType === "modifier" || keyType === "space" ? "-0.02em" : "0";

  const keyStyle: React.CSSProperties = {
    gridColumn: `span ${spanUnits}`,
    backgroundColor: isSpacer ? "transparent" : bgColor,
    border: isSpacer ? "none" : "1px solid rgba(160, 220, 255, 0.15)",
    borderRadius: "12px",
    boxShadow: "none",
    height,
    display: "flex",
    flexDirection: "column",
    justifyContent: keyType === "modifier" ? "flex-end" : dualSymbolParts ? "space-between" : "center",
    alignItems:
      textAlign === "left" ? "flex-start" : textAlign === "right" ? "flex-end" : "center",
    paddingLeft: keyType === "modifier" ? "0.8rem" : "0",
    paddingRight: keyType === "modifier" ? "0.8rem" : "0",
    paddingBottom: keyType === "modifier" ? "0.6rem" : dualSymbolParts ? "0.5rem" : "0",
    paddingTop: dualSymbolParts ? "0.5rem" : "0",
    fontFamily: "'SF Pro', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize,
    lineHeight,
    letterSpacing,
    color: textColor,
    userSelect: "none",
    pointerEvents: isSpacer ? "none" : "auto",
    cursor: "default",
  };

  return (
    <div
      role="gridcell"
      aria-label={ariaLabel || (typeof label === "string" ? label : undefined)}
      style={keyStyle}
    >
      {dualSymbolParts ? (
        <>
          <span>{dualSymbolParts[0]}</span>
          <span>{dualSymbolParts[1]}</span>
        </>
      ) : (
        label
      )}
    </div>
  );
});
Key.displayName = "Key";

// ---------- Main KeyboardHeatmap Component (Memoized) ----------
export const KeyboardHeatmap: React.FC<KeyboardHeatmapProps> = React.memo(
  ({ language, performanceData, className = "", size = "large" }) => {
    const layout = ENHANCED_LAYOUTS[language];
    const colorMap = useHeatmapColorMap(performanceData);
    const dir = language === "ar" ? "rtl" : "ltr";
    const gaps = GAP_MAP[size];

    return (
      <div
        role="grid"
        aria-label={`خريطة حرارية للوحة المفاتيح - ${language}`}
        dir={dir}
        className={className}
        style={CONTAINER_STYLE}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: gaps.row }}>
          {layout.map((row, rowIndex) => (
            <div
              key={rowIndex}
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${row.totalUnits}, minmax(0, 1fr))`,
                gap: gaps.col,
              }}
            >
              {row.keys.map((enhancedKey) => {
                const { bg: bgColor, text: textColor } =
                  colorMap[enhancedKey.id] ?? enhancedKey.defaultColors;

                return (
                  <Key
                    key={enhancedKey.id}
                    enhancedKey={enhancedKey}
                    bgColor={bgColor}
                    textColor={textColor}
                    size={size}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }
);
KeyboardHeatmap.displayName = "KeyboardHeatmap";

export default KeyboardHeatmap;