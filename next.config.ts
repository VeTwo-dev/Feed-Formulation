import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  
  reactStrictMode: true,
  typescript: {
    // Ignore TypeScript errors during development
    ignoreBuildErrors: true,
  },
  cacheComponents: true,
};

export default nextConfig;
