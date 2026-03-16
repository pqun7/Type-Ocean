// Increase limit for EventEmitter warnings
import process from "process";
process.setMaxListeners(20);

import path from "path";
import type { NextConfig } from "next";
import { securityHeaderEntries } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaderEntries,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
    resolveAlias: {
      "@": "./src",
    },
  },

  eslint: {
    ignoreDuringBuilds: true,
  },
  
  serverExternalPackages: [
    "@opentelemetry/instrumentation",
    "@sentry/node",
    "@sentry/nextjs",
    "bcryptjs", 
    "google-auth-library",
    "google-p12-pem",
    "gtoken",
    "gcp-metadata",
    "https-proxy-agent"
  ],
  
  // Add transpile packages for better compatibility
  transpilePackages: ['next-font'],
  
  webpack: (config, { isServer, webpack }) => {
    // Fix for font loading issues
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve(__dirname, "src"),
    };

    // Add rule for font files
    config.module.rules.push({
      test: /\.(woff|woff2|eot|ttf|otf)$/i,
      type: 'asset/resource',
      generator: {
        filename: 'static/fonts/[name].[hash][ext]'
      }
    });

    // Allow importing 3D models (glTF / GLB) from client code.
    // This emits the file into Next's static output and returns a URL string.
    config.module.rules.push({
      test: /\.(glb|gltf)$/i,
      type: "asset/resource",
      generator: {
        filename: "static/models/[name].[hash][ext]",
      },
    });
    
    if (!isServer) {
      // Client-side: Completely exclude Node.js modules and problematic packages
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
        assert: false,
        url: false,
        querystring: false,
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
        'node:child_process': false,
        'node:net': false,
        'node:tls': false,
        'node:assert': false,
      };

      // Replace problematic modules with empty modules
      config.resolve.alias = {
        ...config.resolve.alias,
        'google-auth-library': false,
        'gcp-metadata': false,
        'gtoken': false,
        'google-p12-pem': false,
        'https-proxy-agent': false,
        'winston': false,
        'winston-transport': false,
        // Fix Turbopack font loading
        '@vercel/turbopack-next/internal/font/google/font': false,
      };

      // Use IgnorePlugin to completely ignore server-only modules on client side
      config.plugins.push(
        // Fix for Turbopack font issues
        new webpack.IgnorePlugin({
          resourceRegExp: /@vercel\/turbopack-next\/internal\/font\/google\/font/,
        }),
        
        // Google Auth Library and related packages
        new webpack.IgnorePlugin({
          resourceRegExp: /^google-auth-library$/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^gcp-metadata$/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^gtoken$/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^google-p12-pem$/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^https-proxy-agent$/,
        }),
        
        // Winston logging packages
        new webpack.IgnorePlugin({
          resourceRegExp: /^winston$/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^winston-transport$/,
        }),
        
        // Ignore specific problematic files from Google Auth Library
        new webpack.IgnorePlugin({
          resourceRegExp: /google-auth-library\/build\/src\/auth\/googleauth/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /google-auth-library\/build\/src\/auth\/pluggable-auth-handler/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /google-auth-library\/build\/src\/auth\/identitypoolclient/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /gcp-metadata\/build\/src\/gcp-residency/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /winston\/dist\/winston\/tail-file/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /winston\/dist\/winston\/transports\/file/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /https-proxy-agent\/dist\/agent/,
        }),
        
        // Ignore any file that tries to require Node.js built-ins
        new webpack.IgnorePlugin({
          resourceRegExp: /^fs$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^child_process$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^net$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^tls$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^os$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^path$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^crypto$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^util$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^stream$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^events$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^buffer$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^string_decoder$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^zlib$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^assert$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^url$/,
          contextRegExp: /node_modules/,
        }),
        new webpack.IgnorePlugin({
          resourceRegExp: /^querystring$/,
          contextRegExp: /node_modules/,
        })
      );

    }
    
    return config;
  },
};

export default nextConfig;
