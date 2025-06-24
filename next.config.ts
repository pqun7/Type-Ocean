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
  webpack: (config, { isServer, webpack }) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve(__dirname, "src"),
    };
    
    if (!isServer) {
      // Client-side: Completely exclude Prisma and Node.js modules
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
        // Node.js protocol modules
        'node:module': false,
        'node:fs': false,
        'node:path': false,
        'node:os': false,
        'node:crypto': false,
        'node:stream': false,
        'node:util': false,
        'node:buffer': false,
        'node:events': false,
        'node:zlib': false,
        'node:process': false,
        'node:url': false,
        'node:querystring': false,
      };

      // Use IgnorePlugin to completely ignore Prisma on client side
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^@prisma\/client$/,
        })
      );

      // Additional externals for client side
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        {
          '@prisma/client': 'commonjs @prisma/client',
          'prisma': 'commonjs prisma',
        }
      ];
    } else {
      // Server-side: Allow Prisma to work normally but externalize it
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        {
          '@prisma/client': '@prisma/client',
        }
      ];
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