/**
 * Shared headless Chromium launch for partner form submits (Tron, GoodPWR,
 * SolQ, Empower Typeform).
 *
 * - Local / non-Vercel: full `puppeteer` (devDependency) with bundled Chromium
 * - Vercel / Lambda: `puppeteer-core` + `@sparticuz/chromium`
 *
 * Next.js file tracing often drops `@sparticuz/chromium/bin`, which causes
 * "The input directory .../bin does not exist". On serverless we therefore
 * fall back to a remote pack URL (downloaded at cold start into /tmp).
 */
import { existsSync } from "fs";
import path from "path";
import { env } from "@/lib/env";

export type HeadlessBrowser = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newPage: () => Promise<any>;
  close: () => Promise<void>;
};

/** Matches installed `@sparticuz/chromium` 149.x (x64 = Vercel Node runtime). */
const DEFAULT_CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

async function resolveServerlessExecutablePath(
  chromium: typeof import("@sparticuz/chromium").default,
): Promise<string> {
  const remote = env.chromiumRemoteExecPath?.trim() || DEFAULT_CHROMIUM_PACK_URL;

  const localBin = path.join(process.cwd(), "node_modules", "@sparticuz", "chromium", "bin");
  if (existsSync(localBin)) {
    try {
      return await chromium.executablePath(localBin);
    } catch {
      // Fall through to remote pack.
    }
  }

  return chromium.executablePath(remote);
}

async function launchServerlessChromium(options: {
  graphics: boolean;
  viewport: { width: number; height: number };
}): Promise<HeadlessBrowser> {
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = await import("puppeteer-core");
  chromium.setGraphicsMode = options.graphics;
  const executablePath = await resolveServerlessExecutablePath(chromium);
  return (await puppeteer.launch({
    args: chromium.args,
    defaultViewport: options.viewport,
    executablePath,
    headless: true,
  })) as unknown as HeadlessBrowser;
}

export async function launchHeadlessBrowser(): Promise<HeadlessBrowser> {
  if (isServerlessRuntime()) {
    // Smaller /tmp footprint; graphics unused for form fills.
    return launchServerlessChromium({
      graphics: false,
      viewport: { width: 1280, height: 720 },
    });
  }

  const puppeteer = await import("puppeteer");
  return (await puppeteer.launch({ headless: true })) as unknown as HeadlessBrowser;
}

/**
 * Headless Chromium with SwiftShader WebGL. Needed for ArcGIS Instant Apps.
 * Do not reuse {@link launchHeadlessBrowser} — that turns graphics off.
 */
export async function launchMapScreenshotBrowser(): Promise<HeadlessBrowser> {
  if (isServerlessRuntime()) {
    return launchServerlessChromium({
      graphics: true,
      viewport: { width: 1440, height: 900 },
    });
  }

  const puppeteer = await import("puppeteer");
  return (await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })) as unknown as HeadlessBrowser;
}
