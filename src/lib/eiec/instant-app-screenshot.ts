import { getGraphAccessToken, GRAPH_BASE } from "@/lib/microsoft/graph-auth";
import { launchMapScreenshotBrowser } from "@/lib/onboarding/headless-browser";

export const EIEC_INSTANT_APP_URL =
  "https://illinois.maps.arcgis.com/apps/instant/lookup/index.html?appid=dece08e33d2a49ba8f30cba986a2c298";

/** Testing-only SharePoint target. Not the live Illinois MES Reps library. */
export const EIEC_TEST_SITE = "noxpwr.sharepoint.com:/sites/CommissionMigrationTest";
export const EIEC_TEST_FOLDER = "Test Eligibility";

const ELIGIBLE_RE = /this area is an equity investment eligible community/i;
const NOT_ELIGIBLE_RE = /this area is not an equity investment eligible community/i;
const WEBGL_RE = /webgl2 support is required|unable to display map/i;

export type InstantAppScreenshotResult = {
  address: string;
  eligibleBanner: boolean;
  notEligibleBanner: boolean;
  webglFailed: boolean;
  snippet: string;
  png: Buffer;
  elapsedMs: number;
};

export async function screenshotEiecInstantApp(
  address: string,
): Promise<InstantAppScreenshotResult> {
  const started = Date.now();
  const browser = await launchMapScreenshotBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45_000);
    await page.goto(`${EIEC_INSTANT_APP_URL}&find=${encodeURIComponent(address)}`, {
      waitUntil: "networkidle2",
      timeout: 60_000,
    });
    await page.waitForSelector("calcite-autocomplete", { timeout: 30_000 });
    await sleep(3_000);

    let text = await pageText(page);
    if (!ELIGIBLE_RE.test(text) && !NOT_ELIGIBLE_RE.test(text) && !WEBGL_RE.test(text)) {
      await page.click("calcite-autocomplete");
      await page.keyboard.type(address, { delay: 20 });
      await sleep(1_800);
      await page.keyboard.press("Enter");
      const submit = await page.$(".esri-search__submit-button");
      if (submit) await submit.click();
    }

    const deadline = Date.now() + 35_000;
    while (Date.now() < deadline) {
      text = await pageText(page);
      if (ELIGIBLE_RE.test(text) || NOT_ELIGIBLE_RE.test(text) || WEBGL_RE.test(text)) break;
      await sleep(1_000);
    }

    await sleep(2_000);
    text = await pageText(page);
    const png = Buffer.from(await page.screenshot({ type: "png" }));
    const snippet =
      text.match(/this area is (not )?an equity[\s\S]{0,80}/i)?.[0] ??
      text.match(/webgl[\s\S]{0,120}/i)?.[0] ??
      text.slice(0, 240);

    return {
      address,
      eligibleBanner: ELIGIBLE_RE.test(text),
      notEligibleBanner: NOT_ELIGIBLE_RE.test(text),
      webglFailed: WEBGL_RE.test(text),
      snippet: snippet.replace(/\s+/g, " ").trim(),
      png,
      elapsedMs: Date.now() - started,
    };
  } finally {
    await browser.close();
  }
}

export async function uploadEiecTestScreenshot(fileName: string, png: Buffer): Promise<{
  name: string;
  size: number;
  webUrl: string | null;
}> {
  const token = await getGraphAccessToken();
  const siteRes = await fetch(`${GRAPH_BASE}/sites/${EIEC_TEST_SITE}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const site = (await siteRes.json()) as { id?: string; error?: { message?: string } };
  if (!siteRes.ok || !site.id) {
    throw new Error(site.error?.message ?? `Graph site lookup failed (${siteRes.status})`);
  }

  const encoded = encodeURIComponent(`${EIEC_TEST_FOLDER}/${fileName}`);
  const putRes = await fetch(
    `${GRAPH_BASE}/sites/${site.id}/drive/root:/${encoded}:/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
      },
      body: new Uint8Array(png),
    },
  );
  const putJson = (await putRes.json()) as {
    name?: string;
    size?: number;
    webUrl?: string;
    error?: { message?: string };
  };
  if (!putRes.ok || !putJson.name) {
    throw new Error(putJson.error?.message ?? `Graph upload failed (${putRes.status})`);
  }
  return {
    name: putJson.name,
    size: putJson.size ?? png.length,
    webUrl: putJson.webUrl ?? null,
  };
}

async function pageText(page: { evaluate: (fn: () => string) => Promise<string> }): Promise<string> {
  return page.evaluate(() => document.body?.innerText || "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
