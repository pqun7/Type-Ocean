export function getDatabaseErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isDatabaseAccountHoldError(error: unknown): boolean {
  const code = getDatabaseErrorCode(error);
  if (code !== "P5000" && code !== "P6003") return false;
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("planlimitreached") ||
    message.includes("p6003") ||
    message.includes("hold on your account")
  );
}

export function isDatabaseTemporarilyUnavailableError(error: unknown): boolean {
  const code = getDatabaseErrorCode(error);
  if (code === "P5010" || code === "ECONNRESET" || code === "57P01" || code === "53300") return true;
  if (isDatabaseAccountHoldError(error)) return true;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("fetch failed")) return true;
  }

  return false;
}