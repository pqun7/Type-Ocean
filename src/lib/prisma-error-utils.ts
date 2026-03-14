import { Prisma } from "@prisma/client";

export function getPrismaErrorCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }

  if (typeof error !== "object" || error === null) return null;
  if (!("code" in error)) return null;

  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : null;
}

export function isPrismaAccountHoldError(error: unknown): boolean {
  if (getPrismaErrorCode(error) !== "P5000") return false;
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("planlimitreached") ||
    message.includes("p6003") ||
    message.includes("hold on your account")
  );
}

export function isPrismaTemporarilyUnavailableError(error: unknown): boolean {
  const code = getPrismaErrorCode(error);
  if (code === "P5010") return true;
  if (isPrismaAccountHoldError(error)) return true;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("fetch failed")) return true;
  }

  return false;
}