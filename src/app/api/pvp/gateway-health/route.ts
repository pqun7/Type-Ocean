export const runtime = "nodejs";

import { NextResponse } from "next/server";

/**
 * Lightweight health proxy for the PvP gateway.
 *
 * The frontend cannot call the gateway's `/healthz` endpoint directly because
 * it is an internal service on a non-public port.  This route fetches it
 * server-side and forwards a minimal status object to the client.
 *
 * URL is read from `PVP_GATEWAY_INTERNAL_URL` (e.g. `http://localhost:8787`).
 * If the env var is absent the response is `{ ok: false, reason: "unconfigured" }`.
 */
export async function GET() {
  const baseUrl = process.env.PVP_GATEWAY_INTERNAL_URL?.trim();

  if (!baseUrl) {
    return NextResponse.json({ ok: false, reason: "unconfigured" }, { status: 200 });
  }

  // Validate that the configured URL is a legitimate http/https origin to
  // prevent accidental SSRF if the env var is misconfigured.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_config" }, { status: 200 });
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return NextResponse.json({ ok: false, reason: "invalid_config" }, { status: 200 });
  }

  const healthUrl = new URL("/healthz", parsedUrl).toString();

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    return NextResponse.json({ ok: false, reason: "unhealthy" }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, reason: "unreachable" }, { status: 200 });
  }
}
