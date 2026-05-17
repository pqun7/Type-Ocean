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

// RFC-1918 / link-local / loopback hostnames that must never be fetched as
// avatar URLs — guards against Server-Side Request Forgery (SSRF).
const SSRF_BLOCKLIST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|fd[0-9a-f]{2}:)/i;

// Known cloud metadata service hostnames.
const METADATA_BLOCKLIST = new Set([
  "169.254.169.254", // AWS / GCP / Azure IMDS
  "metadata.google.internal",
  "metadata.internal",
]);

export function sanitizeAvatarUrl(value: string | null | undefined, maxLength = 2048) {
  if (typeof value !== "string") return null;

  const normalized = sanitizeOpaqueHeaderValue(value, maxLength);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    const host = parsed.hostname.toLowerCase();
    if (SSRF_BLOCKLIST_RE.test(host) || METADATA_BLOCKLIST.has(host)) return null;

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
