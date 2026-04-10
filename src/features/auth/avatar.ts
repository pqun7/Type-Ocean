import { sanitizeAvatarUrl } from "@/lib/sanitize";

export function resolveAvatarUrl(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    const normalized = sanitizeAvatarUrl(
      typeof candidate === "string" ? candidate : null,
    );
    if (normalized) return normalized;
  }

  return null;
}

export function getAvatarFallbackText(
  username: string | null | undefined,
  maxCharacters = 2,
  emptyFallback = "U",
): string {
  const trimmed = username?.trim() ?? "";
  if (!trimmed) return emptyFallback;

  return trimmed.slice(0, Math.max(1, maxCharacters)).toUpperCase();
}