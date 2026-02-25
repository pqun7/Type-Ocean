export type SingleKeySfxId =
  | "001"
  | "002"
  | "003"
  | "004"
  | "005"
  | "006"
  | "007"
  | "008"
  | "009"
  | "010"
  | "011"
  | "012"
  | "013"
  | "014"
  | "015"
  | "016"
  | "017"
  | "018"
  | "019"
  | "020"
  | "021"
  | "022"
  | "023"
  | "024"
  | "025"
  | "026"
  | "027"
  | "028"
  | "029"
  | "030"
  | "031"
  | "032";

const BASE_PATH = "/audio/single-keys";

export const SINGLE_KEY_SFX_FILES: Record<SingleKeySfxId, string> = {
  "001": `${BASE_PATH}/keypress_001.wav`,
  "002": `${BASE_PATH}/keypress_002.wav`,
  "003": `${BASE_PATH}/keypress_003.wav`,
  "004": `${BASE_PATH}/keypress_004.wav`,
  "005": `${BASE_PATH}/keypress_005.wav`,
  "006": `${BASE_PATH}/keypress_006.wav`,
  "007": `${BASE_PATH}/keypress_007.wav`,
  "008": `${BASE_PATH}/keypress_008.wav`,
  "009": `${BASE_PATH}/keypress_009.wav`,
  "010": `${BASE_PATH}/keypress_010.wav`,
  "011": `${BASE_PATH}/keypress_011.wav`,
  "012": `${BASE_PATH}/keypress_012.wav`,
  "013": `${BASE_PATH}/keypress_013.wav`,
  "014": `${BASE_PATH}/keypress_014.wav`,
  "015": `${BASE_PATH}/keypress_015.wav`,
  "016": `${BASE_PATH}/keypress_016.wav`,
  "017": `${BASE_PATH}/keypress_017.wav`,
  "018": `${BASE_PATH}/keypress_018.wav`,
  "019": `${BASE_PATH}/keypress_019.wav`,
  "020": `${BASE_PATH}/keypress_020.wav`,
  "021": `${BASE_PATH}/keypress_021.wav`,
  "022": `${BASE_PATH}/keypress_022.wav`,
  "023": `${BASE_PATH}/keypress_023.wav`,
  "024": `${BASE_PATH}/keypress_024.wav`,
  "025": `${BASE_PATH}/keypress_025.wav`,
  "026": `${BASE_PATH}/keypress_026.wav`,
  "027": `${BASE_PATH}/keypress_027.wav`,
  "028": `${BASE_PATH}/keypress_028.wav`,
  "029": `${BASE_PATH}/keypress_029.wav`,
  "030": `${BASE_PATH}/keypress_030.wav`,
  "031": `${BASE_PATH}/keypress_031.wav`,
  "032": `${BASE_PATH}/keypress_032.wav`,
};

export type KeyEventLike = {
  code: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

function isLetterCode(code: string): boolean {
  return /^Key[A-Z]$/.test(code);
}

function isDigitCode(code: string): boolean {
  return /^Digit\d$/.test(code) || /^Numpad\d$/.test(code);
}

function isSymbolKey(key: string): boolean {
  // Printable, but not a single A-Z or 0-9.
  if (key.length !== 1) return false;
  const upper = key.toUpperCase();
  const isAsciiLetter = upper >= "A" && upper <= "Z";
  const isAsciiDigit = key >= "0" && key <= "9";
  return !isAsciiLetter && !isAsciiDigit;
}

function letterCodeToSfxId(code: string): SingleKeySfxId {
  // KeyA..KeyZ => 001..026
  const ch = code[3]!; // e.g. 'A'
  const index = ch.charCodeAt(0) - 65; // 0..25
  const n = index + 1;
  return String(n).padStart(3, "0") as SingleKeySfxId;
}

export function pickSingleKeySfxId(e: KeyEventLike): SingleKeySfxId | null {
  // Don’t click for shortcuts.
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  // Primary special keys
  if (e.code === "Space" || e.key === " ") return "027";
  if (e.code === "Enter" || e.code === "NumpadEnter" || e.key === "Enter") return "028";
  if (e.code === "Backspace" || e.key === "Backspace") return "029";

  // Digits
  if (isDigitCode(e.code)) return "030";

  // Shift / Caps
  if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "CapsLock") return "031";

  // Letters mapped by physical key code (works across languages/layouts)
  if (isLetterCode(e.code)) return letterCodeToSfxId(e.code);

  // Symbols and punctuation
  if (isSymbolKey(e.key)) return "032";

  // Tab isn’t listed in your table; treat it like a symbol.
  if (e.code === "Tab" || e.key === "Tab") return "032";

  return null;
}
