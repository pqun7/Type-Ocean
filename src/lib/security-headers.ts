// lib/security-headers.ts
export const securityHeaders = {
    'Content-Security-Policy': `
      default-src 'self';
      script-src 'self' 'unsafe-inline' *.trusted-cdn.com;
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: *.trusted-cdn.com;
      font-src 'self';
      connect-src 'self' *.our-api.com;
      frame-src 'none';
      object-src 'none';
      base-uri 'self';
      form-action 'self';
    `.replace(/\s+/g, ' '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload'
  }