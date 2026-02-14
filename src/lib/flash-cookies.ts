"use client";

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${escapeRegExp(name)}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function clearCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/**
 * Read and clear a one-time flash cookie.
 */
export function consumeFlashCookie(name: string): string | null {
  const value = readCookie(name);
  if (!value) return null;
  clearCookie(name);
  return value;
}
