import fs from "fs";
import path from "path";

type TextItem = { id: number; content: string };

let cache: string[] | null = null;

export const RANKED_TEXT_MIN_LEN = 165;
export const RANKED_TEXT_MAX_LEN = 210;
const ROOM_TEXT_MIN_LEN = 1400;
const ROOM_TEXT_MAX_LEN = 5000;

function getTextFilePath() {
  const candidates = [
    path.join(process.cwd(), "src", "features", "typing", "data", "en", "long.json"),
    path.join(process.cwd(), "src", "features", "typing", "data", "long.json"),
  ];

  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing ?? candidates[0]!;
}

export function loadLongTexts(): string[] {
  if (cache) return cache;

  const filePath = getTextFilePath();

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const items = JSON.parse(raw) as TextItem[];
    cache = items
      .map((i) => i.content)
      .filter((t) => typeof t === "string")
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter((t) => t.length >= 120);
    if (!cache.length) cache = ["The quick brown fox jumps over the lazy dog.".repeat(60)];
    return cache;
  } catch {
    cache = ["The quick brown fox jumps over the lazy dog.".repeat(60)];
    return cache;
  }
}

export function loadRankedTexts(): string[] {
  const texts = loadLongTexts().filter((text) => text.length >= RANKED_TEXT_MIN_LEN && text.length <= RANKED_TEXT_MAX_LEN);
  return texts.length ? texts : loadLongTexts();
}

export function pickFullPageText(): string {
  const texts = loadLongTexts();
  if (!texts.length) return "The quick brown fox jumps over the lazy dog.".repeat(60);

  const pick = () => texts[Math.floor(Math.random() * texts.length)]!;

  let out = pick();
  while (out.length < ROOM_TEXT_MIN_LEN) {
    const next = pick();
    if (next === out) continue;
    out = `${out}\n\n${next}`;
    if (out.length > ROOM_TEXT_MAX_LEN) break;
  }

  return out.slice(0, ROOM_TEXT_MAX_LEN);
}
