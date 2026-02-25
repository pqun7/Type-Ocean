export type GraphemeSegment = {
  segment: string;
  start: number; // UTF-16 code unit index
  end: number; // UTF-16 code unit index
};

type SegmenterLike = {
  segment: (input: string) => Iterable<{ segment: string; index: number }>;
};

type SegmenterConstructorLike = new (
  locales?: string | string[],
  options?: { granularity?: "grapheme" }
) => SegmenterLike;

function getSegmenterCtor(): SegmenterConstructorLike | null {
  const intl = Intl as unknown as { Segmenter?: unknown };
  const ctor = intl.Segmenter;
  return typeof ctor === "function" ? (ctor as SegmenterConstructorLike) : null;
}

export function segmentGraphemes(text: string, locale?: string): GraphemeSegment[] {
  if (!text) return [];

  const SegmenterCtor = getSegmenterCtor();
  if (SegmenterCtor) {
    const segmenter = new SegmenterCtor(locale, { granularity: "grapheme" });
    const raw = Array.from(segmenter.segment(text));
    return raw.map((s, i) => ({
      segment: s.segment,
      start: s.index,
      end: raw[i + 1]?.index ?? text.length,
    }));
  }

  // Fallback: split by code points (not perfect for ZWJ sequences, but safe enough without Segmenter).
  const segments = Array.from(text);
  const out: GraphemeSegment[] = [];
  let offset = 0;
  for (const seg of segments) {
    const start = offset;
    offset += seg.length;
    out.push({ segment: seg, start, end: offset });
  }
  return out;
}
