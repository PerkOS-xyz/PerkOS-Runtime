import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared packages ship TypeScript source, not a build.
  transpilePackages: ["@perkos/ai", "@perkos/client", "@perkos/desk-contract"],
  // Dependencies are hoisted to the workspace root.
  turbopack: { root: join(__dirname, "../..") },
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"]
};

export default nextConfig;
