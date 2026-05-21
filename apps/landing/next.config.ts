import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
    NEXT_PUBLIC_ENV: process.env.ENVIRONMENT || "development",
    NEXT_PUBLIC_ANALYTICS_LANDING_ENABLED: process.env.ANALYTICS_LANDING_ENABLED ?? "true",
  },
};

export default nextConfig;
