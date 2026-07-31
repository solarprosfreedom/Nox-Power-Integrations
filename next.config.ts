import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Keep Chromium out of the webpack/turbopack bundle so its /bin pack resolves
  // (or we can fall back to CHROMIUM_REMOTE_EXEC_PATH at runtime).
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/cron/sequifi-onboarding": ["./node_modules/@sparticuz/chromium/**/*"],
    "/api/cron/sequifi-onboarding/**/*": ["./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
