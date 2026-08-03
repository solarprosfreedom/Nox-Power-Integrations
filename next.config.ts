import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Chromium out of the webpack/turbopack bundle so its /bin pack resolves
  // (or we can fall back to CHROMIUM_REMOTE_EXEC_PATH at runtime).
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/cron/sequifi-onboarding/**/*": ["./node_modules/@sparticuz/chromium/**/*"],
    "/api/onboarding/retry-partner-steps/**/*": ["./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
