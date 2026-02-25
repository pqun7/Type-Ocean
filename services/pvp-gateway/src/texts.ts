import fs from "fs";
import path from "path";

type TextItem = { id: number; content: string };

let cache: string[] | null = null;

const MIN_TEXT_LEN = 1400;
const MAX_TEXT_LEN = 5000;

export function loadLongTexts(): string[] {
  if (cache) return cache;

  const filePath = path.join(
    process.cwd(),
    "src",
    "features",
    "typing",
    "data",
    "long.json"
  );

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const items = JSON.parse(raw) as TextItem[];
    cache = items
      .map((i) => i.content)
      .filter((t) => typeof t === "string")
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter((t) => t.length >= 120);
    if (!cache.length) cache = ["The quick brown fox jumps over the lazy dog. ".repeat(60)];
    return cache;
  } catch {
    cache = ["The quick brown fox jumps over the lazy dog. ".repeat(60)];
    return cache;
  }
}

export function pickLongText(): string {
  const texts = loadLongTexts();
  if (!texts.length) return "The quick brown fox jumps over the lazy dog. ".repeat(60);

  const pick = () => texts[Math.floor(Math.random() * texts.length)]!;

  let out = pick();
  while (out.length < MIN_TEXT_LEN) {
    const next = pick();
    if (next === out) continue;
    out = `${out}\n\n${next}`;
    if (out.length > MAX_TEXT_LEN) break;
  }

  return out.slice(0, MAX_TEXT_LEN);
}
