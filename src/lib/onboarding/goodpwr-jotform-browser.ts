/**
 * Submits the GoodPWR "New Sales Rep Onboarding" JotForm via headless Chromium.
 *
 * Same rationale as Tron: JotForm's public submit endpoint challenges plain
 * scripted POSTs with CAPTCHA; a real browser session is accepted.
 *
 * Form: https://form.jotform.com/261804783661160
 */
import type { GoodPwrFormFields } from "@/lib/onboarding/goodpwr-form";

export interface BrowserSubmitResult {
  status: "sent" | "failed";
  reason?: string;
}

function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

type PuppeteerBrowser = {
  newPage: () => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  close: () => Promise<void>;
};

async function launchBrowser(): Promise<PuppeteerBrowser> {
  if (isServerlessRuntime()) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteer = await import("puppeteer-core");
    return (await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })) as unknown as PuppeteerBrowser;
  }
  const puppeteer = await import("puppeteer");
  return (await puppeteer.launch({ headless: true })) as unknown as PuppeteerBrowser;
}

export async function submitGoodPwrJotFormViaBrowser(
  fields: GoodPwrFormFields,
  formId: string,
): Promise<BrowserSubmitResult> {
  let browser: PuppeteerBrowser | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(45000);
    await page.setDefaultTimeout(20000);

    await page.goto(`https://form.jotform.com/${formId}`, { waitUntil: "networkidle2" });

    async function fill(selector: string, value: string): Promise<void> {
      if (!value) return;
      const el = await page.$(selector);
      if (!el) throw new Error(`GoodPWR JotForm field not found: ${selector}`);
      await el.click({ clickCount: 3 }).catch(() => undefined);
      await el.type(value, { delay: 10 });
    }

    await fill('input[name="q3_repFull[first]"]', fields.firstName);
    await fill('input[name="q3_repFull[last]"]', fields.lastName);
    await fill('input[name="q51_phoneNumber[full]"]', fields.phone);
    await fill('input[name="q31_email"]', fields.email);
    await fill('input[name="q26_salesPartner"]', fields.salesOrganization);
    if (fields.recheck) {
      await fill('input[name="q35_recheck"]', fields.recheck);
    }

    const marketBoxes = await page.$$('input[name="q45_marketsselect[]"]');
    for (const cb of marketBoxes) {
      const val = await page.evaluate((el: HTMLInputElement) => el.value, cb);
      if (fields.markets.includes(val)) await cb.click();
    }

    const hisBoxes = await page.$$('input[name="q46_hisLicense[]"]');
    for (const cb of hisBoxes) {
      const val = await page.evaluate((el: HTMLInputElement) => el.value, cb);
      if (val === fields.hisLicense) await cb.click();
    }

    const enerfloRadio = await page.$(
      `input[name="q47_willYou"][value="${fields.usingEnerflo}"]`,
    );
    if (!enerfloRadio) {
      return { status: "failed", reason: `Enerflo radio not found: ${fields.usingEnerflo}` };
    }
    await enerfloRadio.click();

    await page.select('select[name="q48_preferredLender"]', fields.preferredLender);
    await page.select('select[name="q49_preferredTpo"]', fields.preferredTpo);

    if (fields.comments) {
      await fill('textarea[name="q50_anyAdditional"]', fields.comments);
    }

    const submitBtn = await page.$(
      'button[type="submit"], input[type="submit"], #input_2, button.form-submit-button',
    );
    if (!submitBtn) {
      return { status: "failed", reason: "GoodPWR JotForm submit button not found on page" };
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => null),
      submitBtn.click(),
    ]);

    const bodyText: string = await page.evaluate(() => document.body.innerText);
    const url: string = page.url();

    const looksLikeCaptchaChallenge = /captcha/i.test(bodyText) || /please complete/i.test(bodyText);
    const looksLikeSuccess = /thank you/i.test(bodyText) || url.includes("submit.jotform.com");
    const looksLikeValidationError = /error on this page/i.test(bodyText);

    if (looksLikeCaptchaChallenge) {
      return {
        status: "failed",
        reason: "JotForm still returned a CAPTCHA/bot challenge even via headless browser submission.",
      };
    }
    if (looksLikeValidationError) {
      return {
        status: "failed",
        reason: `JotForm rejected the submission with a validation error: ${bodyText.slice(0, 300)}`,
      };
    }
    if (!looksLikeSuccess) {
      return {
        status: "failed",
        reason: `Unexpected page after submit (url=${url}): ${bodyText.slice(0, 300)}`,
      };
    }

    return { status: "sent" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "failed", reason: `Headless browser submission error: ${msg}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
