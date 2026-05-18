import http from "http";
import https from "https";
import fs from "fs";
import { IS_PROD, TRUST_PROXY_TLS, INSECURE_LOCALHOST, INSTANCE_ID } from "../shared/config";
import { gatewayLogInfo, gatewayLogWarn, gatewayLogError } from "../shared/logger";
import { renderGatewayMetrics, setGatewayGauge } from "../metrics";
import type { GatewayHealthController } from "../health";
import type { GatewayMetrics } from "../observability/metrics";

// ---------------------------------------------------------------------------
// Allowed origin management
// ---------------------------------------------------------------------------

function parseAllowedOrigins(): Set<string> | null {
  const raw = process.env.PVP_ALLOWED_ORIGINS;
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}

export const allowedOrigins = parseAllowedOrigins();

if (IS_PROD && !allowedOrigins) {
  throw new Error("Missing PVP_ALLOWED_ORIGINS in production");
}

export function originAllowed(origin: string | undefined | null): boolean {
  if (!allowedOrigins) return true;
  if (!origin) return false;
  return allowedOrigins.has(origin);
}

function isLocalhostHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isLocalOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return isLocalhostHost(parsed.hostname);
  } catch {
    return false;
  }
}

function hasOnlyLocalOrigins(): boolean {
  if (!allowedOrigins || allowedOrigins.size === 0) return false;
  return Array.from(allowedOrigins).every(isLocalOrigin);
}

function isLocalHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;

  const trimmed = hostHeader.trim();
  if (!trimmed) return false;

  const normalizedHost = trimmed.startsWith("[")
    ? trimmed.slice(1, trimmed.indexOf("]"))
    : trimmed.split(":")[0] ?? trimmed;

  return isLocalhostHost(normalizedHost);
}

function isLocalGatewayRequest(req: http.IncomingMessage): boolean {
  if (isLoopbackAddress(req.socket.remoteAddress)) {
    return true;
  }

  if (isLocalHostHeader(req.headers.host)) {
    return true;
  }

  return typeof req.headers.origin === "string" && isLocalOrigin(req.headers.origin);
}

export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const normalized = remoteAddress.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:127.0.0.1")
  );
}

export function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }

  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();

  return req.socket.remoteAddress ?? "unknown";
}

export function isSecureGatewayRequest(
  req: http.IncomingMessage
): boolean {
  if (!IS_PROD) return true;

  if (INSECURE_LOCALHOST && isLocalGatewayRequest(req)) {
    return true;
  }

  if ((req.socket as { encrypted?: boolean }).encrypted) return true;

  if (!TRUST_PROXY_TLS) return false;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto.split(",")[0]?.trim().toLowerCase() === "https";
  }

  return false;
}

// ---------------------------------------------------------------------------
// HTTP / HTTPS server creation
// ---------------------------------------------------------------------------

export type GatewayServerDeps = {
  /** Returns the current GatewayMetrics instance (may be null until main() runs). */
  getGatewayMetrics: () => GatewayMetrics | null;
  /** Returns the current health controller (may be null until main() runs). */
  getHealthController: () => GatewayHealthController | null;
};

export function createGatewayServer(deps: GatewayServerDeps): http.Server | https.Server {
  const healthHandler: http.RequestListener = (req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
    void (async () => {
      if (path === "/metrics") {
        setGatewayGauge("pvp_gateway_uptime_seconds", Number(process.uptime().toFixed(3)));
        setGatewayGauge("pvp_gateway_heap_used_bytes", process.memoryUsage().heapUsed);
        const metrics = deps.getGatewayMetrics();
        const body = metrics ? await metrics.renderMetrics() : renderGatewayMetrics();
        res.writeHead(200, {
          "Content-Type": metrics?.register.contentType ?? "text/plain; version=0.0.4; charset=utf-8",
        });
        res.end(body);
        return;
      }

      if (path === "/health" || path === "/healthz") {
        const controller = deps.getHealthController();
        const response = controller
          ? await controller.evaluate("health")
          : { statusCode: 200, body: { status: "ok", instanceId: INSTANCE_ID } };
        res.writeHead(response.statusCode, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(response.body));
        return;
      }

      if (path === "/ready") {
        const controller = deps.getHealthController();
        const response = controller
          ? await controller.evaluate("ready")
          : { statusCode: 503, body: { status: "not_ready", instanceId: INSTANCE_ID } };
        res.writeHead(response.statusCode, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(response.body));
        return;
      }

      if (path === "/") {
        res.writeHead(200);
        res.end("pvp-gateway ok");
        return;
      }

      res.writeHead(404);
      res.end("not found");
    })().catch((error: unknown) => {
      gatewayLogError("Gateway probe handler failed", error, { path });
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end("internal error");
    });
  };

  if (!IS_PROD) {
    return http.createServer(healthHandler);
  }

  if (TRUST_PROXY_TLS) {
    gatewayLogInfo("Starting PvP gateway behind trusted TLS proxy", {
      trustProxyTls: true,
    });
    return http.createServer(healthHandler);
  }

  if (INSECURE_LOCALHOST) {
    if (!hasOnlyLocalOrigins()) {
      throw new Error("PVP_INSECURE_LOCALHOST requires all PVP_ALLOWED_ORIGINS values to be localhost/127.0.0.1");
    }

    gatewayLogWarn("Starting PvP gateway in insecure localhost mode", {
      insecureLocalhost: true,
      warning: "Development only. Disable PVP_INSECURE_LOCALHOST for deployed environments.",
    });
    return http.createServer(healthHandler);
  }

  const keyPath = process.env.PVP_TLS_KEY_PATH;
  const certPath = process.env.PVP_TLS_CERT_PATH;
  if (!keyPath || !certPath) {
    throw new Error("Missing PVP_TLS_KEY_PATH or PVP_TLS_CERT_PATH in production (or set PVP_TRUST_PROXY_TLS=1 behind a trusted proxy)");
  }

  return https.createServer(
    {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      ca: process.env.PVP_TLS_CA_PATH ? fs.readFileSync(process.env.PVP_TLS_CA_PATH) : undefined,
    },
    healthHandler
  );
}
