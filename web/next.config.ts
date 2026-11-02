import type { NextConfig } from "next";

// Every screen in Reel Studio is private and per-user, so the app opts out of
// Cache Components and renders on request.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
