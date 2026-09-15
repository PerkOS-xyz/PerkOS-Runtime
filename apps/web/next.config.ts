import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: __dirname },
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"]
};

export default nextConfig;
