function collectConnectSources() {
  const values = new Set<string>(["'self'"]);

  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_PVP_WS_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      values.add(url.origin);
      if (url.protocol === "wss:" || url.protocol === "https:") {
        values.add(candidate);
      }
    } catch {
      // Ignore invalid URL configuration. Validation happens elsewhere.
    }
  }

  values.add("https:");
  values.add("wss:");

  return Array.from(values).join(" ");
}

function buildContentSecurityPolicy() {
  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `form-action 'self'`,
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
    `style-src 'self' 'unsafe-inline' https:`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data: https:`,
    `connect-src ${collectConnectSources()}`,
  ];

  if (process.env.NODE_ENV === "production") {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export const securityHeaders = {
  "Content-Security-Policy": buildContentSecurityPolicy(),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-DNS-Prefetch-Control": "off",
  "X-Frame-Options": "DENY",
};

export const securityHeaderEntries = Object.entries(securityHeaders).map(([key, value]) => ({
  key,
  value,
}));