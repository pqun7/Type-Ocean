// Increase limit for EventEmitter warnings
import process from "process";
process.setMaxListeners(20);

import {withSentryConfig} from "@sentry/nextjs";
import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@prisma/client", 
    "bcryptjs", 
    "winston", 
    "winston-transport",
    "google-auth-library",
    "google-p12-pem",
    "gtoken",
    "gcp-metadata",
    "https-proxy-agent"
  ],
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve(__dirname, "src"),
    };
    
    // Only apply fallbacks for client-side builds
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        os: false,
        path: false,
        crypto: false,
        stream: false,
        util: false,
        buffer: false,
        events: false,
        string_decoder: false,
        zlib: false,
      };
      
      // Ignore winston and related server-only modules on client
      config.externals = config.externals || [];
      config.externals.push({
        winston: 'commonjs winston',
        'winston-transport': 'commonjs winston-transport',
        'google-auth-library': 'commonjs google-auth-library',
        'google-p12-pem': 'commonjs google-p12-pem',
        'gtoken': 'commonjs gtoken',
        'gcp-metadata': 'commonjs gcp-metadata',
        'https-proxy-agent': 'commonjs https-proxy-agent'
      });
    }
    
    return config;
  },
};

export default withSentryConfig(nextConfig, {
// For all available options, see:
// https://www.npmjs.com/package/@sentry/webpack-plugin#options

org: "student-6o6",
project: "javascript-nextjs",

// Only print logs for uploading source maps in CI
silent: !process.env.CI,

// For all available options, see:
// https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

// Upload a larger set of source maps for prettier stack traces (increases build time)
widenClientFileUpload: true,

// Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
// This can increase your server load as well as your hosting bill.
// Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
// side errors will fail.
tunnelRoute: "/monitoring",

// Automatically tree-shake Sentry logger statements to reduce bundle size
disableLogger: true,

// Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
// See the following for more information:
// https://docs.sentry.io/product/crons/
// https://vercel.com/docs/cron-jobs
automaticVercelMonitors: true,
});