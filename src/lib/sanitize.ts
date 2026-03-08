const CONTROL_CHARACTERS_REGEX = /[\u0000-\u001F\u007F-\u009F]/g;
const MULTI_WHITESPACE_REGEX = /\s+/g;
const ROOM_CODE_ALLOWED_REGEX = /[^A-Z0-9]/g;

function normalizeUnicode(value: string) {
  return value.normalize("NFKC");
}

export function stripControlCharacters(value: string) {
  return value.replace(CONTROL_CHARACTERS_REGEX, "");
}

export function collapseWhitespace(value: string) {
  return value.replace(MULTI_WHITESPACE_REGEX, " ").trim();
}

export function canonicalizeText(value: string) {
  return collapseWhitespace(stripControlCharacters(normalizeUnicode(value)));
}

export function sanitizeTextField(value: string, maxLength: number) {
  return canonicalizeText(value).slice(0, Math.max(0, maxLength));
}

export function sanitizeOpaqueHeaderValue(value: string, maxLength = 256) {
  return stripControlCharacters(normalizeUnicode(value)).trim().slice(0, Math.max(0, maxLength));
}

export function sanitizeRoomCode(value: string, maxLength = 10) {
  return sanitizeOpaqueHeaderValue(value, maxLength)
    .toUpperCase()
    .replace(ROOM_CODE_ALLOWED_REGEX, "")
    .slice(0, Math.max(0, maxLength));
}

export function sanitizeDisplayName(value: string, maxLength = 32) {
  return sanitizeTextField(value, maxLength);
}

export function sanitizeAvatarUrl(value: string | null | undefined, maxLength = 2048) {
  if (typeof value !== "string") return null;

  const normalized = sanitizeOpaqueHeaderValue(value, maxLength);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString().slice(0, maxLength);
  } catch {
    return null;
  }
}

export function sanitizeUserAgent(value: string | null | undefined, maxLength = 512) {
  if (typeof value !== "string") return "unknown";
  const normalized = sanitizeOpaqueHeaderValue(value, maxLength);
  return normalized || "unknown";
}
