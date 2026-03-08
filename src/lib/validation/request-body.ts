import type { NextRequest } from "next/server";
import type { ZodType } from "zod";

export async function readJsonBody(req: NextRequest, maxBytes = 1024) {
  const raw = await req.text();
  if (!raw) {
    return { success: true as const, data: null };
  }

  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    return { success: false as const, error: "Payload too large" };
  }

  try {
    return { success: true as const, data: JSON.parse(raw) as unknown };
  } catch {
    return { success: false as const, error: "Invalid JSON" };
  }
}

export async function parseJsonBodyWithSchema<T>(params: {
  req: NextRequest;
  schema: ZodType<T>;
  maxBytes?: number;
}) {
  const bodyResult = await readJsonBody(params.req, params.maxBytes);
  if (!bodyResult.success) {
    return bodyResult;
  }

  const parsed = params.schema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return {
      success: false as const,
      error: "Invalid payload",
      issues: parsed.error.flatten(),
    };
  }

  return {
    success: true as const,
    data: parsed.data,
  };
}
