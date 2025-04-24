import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {

  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve(__dirname, "src"),
    };
    return config;
  },
};

export default nextConfig;
