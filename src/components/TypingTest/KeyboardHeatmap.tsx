"use client";

import React, { useMemo } from 'react';

// ---------- Types ----------
export type KeyId = string;
export type KeyType = 'letter' | 'symbol' | 'modifier' | 'space';

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

export type Language = 'en' | 'ar' | 'fr' | 'es';
export type Size = 'small' | 'medium' | 'large';

export interface KeyboardHeatmapProps {
  language: Language;
  performanceData?: PerformanceData;
  showLegend?: boolean;
  className?: string;
  size?: Size;
}

// ---------- Layout Definitions ----------
const createFiveRowLayout = (spaceLabel: string): Layout => [
  {
    keys: [
      { id: 'Backtick', label: '` ~', span: 1, keyType: 'symbol' },
      { id: '1', label: '1', span: 1, keyType: 'symbol' },
      { id: '2', label: '2', span: 1, keyType: 'symbol' },
      { id: '3', label: '3', span: 1, keyType: 'symbol' },
      { id: '4', label: '4', span: 1, keyType: 'symbol' },
      { id: '5', label: '5', span: 1, keyType: 'symbol' },
      { id: '6', label: '6', span: 1, keyType: 'symbol' },
      { id: '7', label: '7', span: 1, keyType: 'symbol' },
      { id: '8', label: '8', span: 1, keyType: 'symbol' },
      { id: '9', label: '9', span: 1, keyType: 'symbol' },
      { id: '0', label: '0', span: 1, keyType: 'symbol' },
      { id: 'Delete', label: 'Delete', span: 2, ariaLabel: 'Delete', keyType: 'modifier' },
    ],
  },
  {
    keys: [
      { id: 'Tab', label: 'Tab', span: 2, ariaLabel: 'Tab', keyType: 'modifier' },
      { id: 'q', label: 'Q', span: 1, keyType: 'letter' },
      { id: 'w', label: 'W', span: 1, keyType: 'letter' },
      { id: 'e', label: 'E', span: 1, keyType: 'letter' },
      { id: 'r', label: 'R', span: 1, keyType: 'letter' },
      { id: 't', label: 'T', span: 1, keyType: 'letter' },
      { id: 'y', label: 'Y', span: 1, keyType: 'letter' },
      { id: 'u', label: 'U', span: 1, keyType: 'letter' },
      { id: 'i', label: 'I', span: 1, keyType: 'letter' },
      { id: 'o', label: 'O', span: 1, keyType: 'letter' },
      { id: 'p', label: 'P', span: 1, keyType: 'letter' },
      { id: 'BracketLeft', label: '{ [', span: 1, keyType: 'symbol' },
      { id: 'BracketRight', label: '} ]', span: 1, keyType: 'symbol' },
      { id: 'Backslash', label: '\\ |', span: 1, keyType: 'symbol' },
    ],
  },
  {
    keys: [
      { id: 'CapsLock', label: 'Caps Lock', span: 2.5, ariaLabel: 'Caps Lock', keyType: 'modifier' },
      { id: 'a', label: 'A', span: 1, keyType: 'letter' },
      { id: 's', label: 'S', span: 1, keyType: 'letter' },
      { id: 'd', label: 'D', span: 1, keyType: 'letter' },
      { id: 'f', label: 'F', span: 1, keyType: 'letter' },
      { id: 'g', label: 'G', span: 1, keyType: 'letter' },
      { id: 'h', label: 'H', span: 1, keyType: 'letter' },
      { id: 'j', label: 'J', span: 1, keyType: 'letter' },
      { id: 'k', label: 'K', span: 1, keyType: 'letter' },
      { id: 'l', label: 'L', span: 1, keyType: 'letter' },
      { id: 'Semicolon', label: ': ;', span: 1, keyType: 'symbol' },
      { id: 'Quote', label: '" \'', span: 1, keyType: 'symbol' },
      { id: 'Enter', label: 'Enter', span: 2, ariaLabel: 'Enter', keyType: 'modifier' },
    ],
  },
  {
    keys: [
      { id: 'ShiftLeft', label: 'Shift', span: 3, ariaLabel: 'Shift', keyType: 'modifier' },
      { id: 'z', label: 'Z', span: 1, keyType: 'letter' },
      { id: 'x', label: 'X', span: 1, keyType: 'letter' },
      { id: 'c', label: 'C', span: 1, keyType: 'letter' },
      { id: 'v', label: 'V', span: 1, keyType: 'letter' },
      { id: 'b', label: 'B', span: 1, keyType: 'letter' },
      { id: 'n', label: 'N', span: 1, keyType: 'letter' },
      { id: 'm', label: 'M', span: 1, keyType: 'letter' },
      { id: 'Comma', label: '< ,', span: 1, keyType: 'symbol' },
      { id: 'Period', label: '> .', span: 1, keyType: 'symbol' },
      { id: 'Slash', label: '/ ?', span: 1, keyType: 'symbol' },
      { id: 'ShiftRight', label: 'Shift', span: 3, ariaLabel: 'Shift', keyType: 'modifier' },
    ],
  },
  {
    keys: [
      { id: 'SpaceLeftPad', label: '', span: 3, ariaLabel: 'Spacer', keyType: 'modifier' },
      { id: 'Space', label: spaceLabel, span: 10, ariaLabel: 'Space', keyType: 'space' },
      { id: 'SpaceRightPad', label: '', span: 3, ariaLabel: 'Spacer', keyType: 'modifier' },
    ],
  },
];

const BASE_LAYOUTS: Record<Language, Layout> = {
  en: createFiveRowLayout('space'),
  ar: createFiveRowLayout('مسافة'),
  fr: createFiveRowLayout('espace'),
  es: createFiveRowLayout('espacio'),
};

// ---------- الألوان الأصلية (داكنة مزرقة) ----------
const GLASS_BG = 'rgba(20, 50, 80, 0.3)';              // خلفية الموقع
const KEY_BASE_GLASS = 'rgba(40, 70, 100, 0.4)';       // المفاتيح العادية
const MODIFIER_GLASS = 'rgba(30, 50, 70, 0.6)';         // المفاتيح المعدلة
const SPACE_GLASS = 'rgba(60, 100, 140, 0.3)';          // مفتاح المسافة

const TEXT_COLORS = {
  light: '#E0E7FF',        // نص فاتح (على الخلفيات الداكنة)
  dark: '#ffffff',         // نص أبيض (على الخلفيات الداكنة أيضاً – كان #ffffff)
};

// ---------- ألوان الخريطة الحرارية (OKLCH مع شفافية) ----------
const useHeatmapColors = (performanceData?: PerformanceData) => {
  return useMemo(() => {
    if (!performanceData) {
      return (keyId: string, keyType: KeyType) => {
        if (keyType === 'modifier' || keyId.includes('Shift')) {
          return { bg: MODIFIER_GLASS, text: TEXT_COLORS.light };
        }
        if (keyType === 'space') {
          return { bg: SPACE_GLASS, text: TEXT_COLORS.dark };
        }
        return { bg: KEY_BASE_GLASS, text: TEXT_COLORS.light };
      };
    }

    const netScores: Record<string, number> = {};
    let maxAbs = 0;

    for (const [keyId, value] of Object.entries(performanceData)) {
      if (value) {
        const net = value.correct - value.error;
        netScores[keyId] = net;
        maxAbs = Math.max(maxAbs, Math.abs(net));
      }
    }

    const scale = (absNet: number) => Math.pow(absNet / maxAbs, 0.5);

    return (keyId: string, keyType: KeyType): { bg: string; text: string } => {
      const net = netScores[keyId];
      if (net === undefined || maxAbs === 0) {
        if (keyType === 'modifier' || keyId.includes('Shift')) {
          return { bg: MODIFIER_GLASS, text: TEXT_COLORS.light };
        }
        if (keyType === 'space') {
          return { bg: SPACE_GLASS, text: TEXT_COLORS.dark };
        }
        return { bg: KEY_BASE_GLASS, text: TEXT_COLORS.light };
      }

      const absNet = Math.abs(net);
      const intensity = scale(absNet);
      const baseLightness = 70; // %
      const lightness = baseLightness - intensity * 25; // 70% → 45%
      const alpha = 0.7;

      if (net > 0) {
        return { bg: `oklch(${lightness}% 0.12 165 / ${alpha})`, text: TEXT_COLORS.light };
      } else if (net < 0) {
        return { bg: `oklch(${lightness}% 0.12 30 / ${alpha})`, text: TEXT_COLORS.light };
      } else {
        return { bg: KEY_BASE_GLASS, text: TEXT_COLORS.light };
      }
    };
  }, [performanceData]);
};

// ---------- مفتاح واحد مع memo (بدون ظلال ولا تفاعلية) ----------
interface KeyProps {
  data: KeyData;
  bgColor: string;
  textColor: string;
  size: Size;
}

const Key: React.FC<KeyProps> = React.memo(({ data, bgColor, textColor, size }) => {
  const { id, label, span, ariaLabel, keyType = 'letter' } = data;
  const spanUnits = Math.max(1, Math.round(span * 2));

  // --- الأحجام الجديدة من النسخة المرجعية ---
  const heightMap: Record<Size, string> = {
    small: '2.8rem',
    medium: '3.7rem',
    large: '4.6rem',
  };
  const fontSizeMap: Record<Size, Record<KeyType, string>> = {
    small:  { letter: '0.82rem', symbol: '0.74rem', modifier: '0.65rem', space: '0.65rem' },
    medium: { letter: '1.08rem', symbol: '0.98rem', modifier: '0.82rem', space: '0.82rem' },
    large:  { letter: '1.44rem', symbol: '1.28rem', modifier: '1.08rem', space: '1.08rem' },
  };
  const lineHeightMap: Record<Size, Record<KeyType, string>> = {
    small:  { letter: '1.2', symbol: '1.2', modifier: '1.2', space: '1.2' },
    medium: { letter: '1.3', symbol: '1.3', modifier: '1.3', space: '1.3' },
    large:  { letter: '1.4', symbol: '1.4', modifier: '1.4', space: '1.4' },
  };

  const height = heightMap[size];
  const fontSize = fontSizeMap[size][keyType];
  const lineHeight = lineHeightMap[size][keyType];
  const letterSpacing = keyType === 'modifier' || keyType === 'space' ? '-0.02em' : '0';

  // معالجة الرموز المزدوجة مثل ": ;"
  const symbolParts = keyType === 'symbol' && typeof label === 'string'
    ? label.split(' ').filter(Boolean)
    : null;
  const isDualSymbol = Boolean(symbolParts && symbolParts.length === 2);

  // محاذاة النص للمفاتيح المعدلة
  let textAlign: 'left' | 'center' | 'right' = 'center';
  if (keyType === 'modifier') {
    if (id === 'Tab' || id === 'CapsLock' || id.includes('ShiftLeft')) textAlign = 'left';
    else if (id === 'Delete' || id === 'Enter' || id.includes('ShiftRight')) textAlign = 'right';
  }

  const isSpacer = id === 'SpaceLeftPad' || id === 'SpaceRightPad';

  const keyStyle: React.CSSProperties = {
    gridColumn: `span ${spanUnits}`,
    backgroundColor: isSpacer ? 'transparent' : bgColor,
    backdropFilter: isSpacer ? 'none' : 'blur(8px)',
    WebkitBackdropFilter: isSpacer ? 'none' : 'blur(8px)',
    border: isSpacer ? 'none' : '1px solid rgba(160, 220, 255, 0.15)',
    borderRadius: '12px',
    boxShadow: 'none',
    height,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: keyType === 'modifier' ? 'flex-end' : isDualSymbol ? 'space-between' : 'center',
    alignItems: textAlign === 'left' ? 'flex-start' : textAlign === 'right' ? 'flex-end' : 'center',
    paddingLeft: keyType === 'modifier' ? '0.8rem' : '0',
    paddingRight: keyType === 'modifier' ? '0.8rem' : '0',
    paddingBottom: keyType === 'modifier' ? '0.6rem' : isDualSymbol ? '0.5rem' : '0',
    paddingTop: isDualSymbol ? '0.5rem' : '0',
    fontFamily: "'SF Pro', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize,
    lineHeight,
    letterSpacing,
    color: textColor,
    userSelect: 'none',
    pointerEvents: isSpacer ? 'none' : 'auto',
    cursor: 'default',
  };

  return (
    <div
      role="gridcell"
      aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
      style={keyStyle}
    >
      {isDualSymbol && symbolParts ? (
        <>
          <span>{symbolParts[0]}</span>
          <span>{symbolParts[1]}</span>
        </>
      ) : (
        label
      )}
    </div>
  );
});

Key.displayName = 'Key';


// ---------- المكون الرئيسي KeyboardHeatmap ----------
export const KeyboardHeatmap: React.FC<KeyboardHeatmapProps> = ({
  language,
  performanceData,
  className = '',
  size = 'large',
}) => {
  const layout = BASE_LAYOUTS[language];
  const getColors = useHeatmapColors(performanceData);
  const dir = language === 'ar' ? 'rtl' : 'ltr';

  const rowsWithMeta = useMemo(
    () =>
      layout.map((row) => {
        const totalUnits = row.keys.reduce((sum, key) => sum + Math.max(1, Math.round(key.span * 2)), 0);
        return { ...row, totalUnits };
      }),
    [layout]
  );

  // --- الفجوات الجديدة من النسخة المرجعية ---
  const gapMap: Record<Size, { row: string; col: string }> = {
    small: { row: '0.2rem', col: '0.24rem' },
    medium: { row: '0.32rem', col: '0.42rem' },
    large: { row: '0.5rem', col: '0.6rem' },
  };
  const gaps = gapMap[size];

  // --- أنماط الحاوية مع الأحجام الجديدة (borderRadius, padding) ---
  const containerStyle: React.CSSProperties = {
    background: GLASS_BG,
    backdropFilter: 'blur(30px)',
    WebkitBackdropFilter: 'blur(30px)',
    borderRadius: '28px',          // من النسخة الجديدة (كان 32px)
    padding: '1.25rem',            // من النسخة الجديدة (كان 1.5rem)
    border: '1px solid rgba(160, 220, 255, 0.15)',
    boxShadow: 'none',
  };

  return (
    <div
      role="grid"
      aria-label={`خريطة حرارية للوحة المفاتيح - ${language}`}
      dir={dir}
      className={className}
      style={containerStyle}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: gaps.row }}>
        {rowsWithMeta.map((row, rowIndex) => (
          <div
            key={rowIndex}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${row.totalUnits}, minmax(0, 1fr))`,
              gap: gaps.col,
            }}
          >
            {row.keys.map((key) => {
              const { bg, text } = getColors(key.id, key.keyType ?? 'letter');
              return <Key key={key.id} data={key} bgColor={bg} textColor={text} size={size} />;
            })}
          </div>
        ))}
      </div>

    </div>
  );
};

export default KeyboardHeatmap;