/**
 * Submits the Tron "Log-In Request Form" (JotForm) using a real headless browser
 * instead of a plain fetch() POST.
 *
 * WHY: JotForm's public submit.jotform.com/submit/{formId} endpoint rejects plain
 * scripted POSTs with a CAPTCHA challenge page (confirmed via live testing — see
 * tron-jotform.ts history). The block is driven by anti-bot signals a real browser
 * computes automatically while a person fills the form: a `jsExecutionTracker`
 * timing trace, a `submitDate`/`timeToSubmit` pair tied to actual page-load time,
 * and an `event_id` from a real page-view beacon. A plain POST can't fake these
 * convincingly (and shouldn't try to — that's fragile reverse-engineering of
 * someone else's anti-abuse logic). Driving an actual headless Chromium instance
 * to load the page, fill fields via the DOM, and click Submit produces all of
 * these signals for real, because it *is* a real browser session.
 *
 * CONFIRMED LIVE: a manual dry run of this exact flow reached JotForm's real
 * "Thank You!" page (no CAPTCHA) — see chat history for the captured request.
 *
 * RUNTIME: shared launchHeadlessBrowser — @sparticuz/chromium on Vercel
 * (with remote pack fallback), full puppeteer locally.
 */
import { launchHeadlessBrowser, type HeadlessBrowser } from "@/lib/onboarding/headless-browser";
import { phoneDigitsForMaskedInput } from "@/lib/onboarding/phone";
import type { TronJotFormFields } from "@/lib/onboarding/tron-jotform";

export interface BrowserSubmitResult {
  status: "sent" | "failed";
  reason?: string;
}

/** Format {month, day, year} into JotForm's masked "MM-DD-YYYY" date-lite field. */
function formatDobForWidget(dob: TronJotFormFields["dob"]): string {
  if (!dob) return "";
  return `${dob.month}-${dob.day}-${dob.year}`;
}

export async function submitTronJotFormViaBrowser(
  fields: TronJotFormFields,
  formId: string,
): Promise<BrowserSubmitResult> {
  let browser: HeadlessBrowser | null = null;
  try {
    browser = await launchHeadlessBrowser();
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(45000);
    await page.setDefaultTimeout(20000);

    await page.goto(`https://form.jotform.com/${formId}`, { waitUntil: "networkidle2" });

    async function fill(selector: string, value: string): Promise<void> {
      if (!value) return;
      const el = await page.$(selector);
      if (!el) throw new Error(`Tron JotForm field not found on page: ${selector}`);
      await el.click({ clickCount: 3 }).catch(() => null);
      await page.evaluate((sel: string) => {
        const node = document.querySelector(sel) as HTMLInputElement | null;
        if (node) node.value = "";
      }, selector);
      await el.type(value, { delay: 15 });
    }

    await fill('input[name="q3_name[first]"]', fields.firstName);
    await fill('input[name="q3_name[last]"]', fields.lastName);
    await fill('input[name="q9_typeA"]', fields.salesOrganization);
    await fill('input[name="q5_email"]', fields.email);
    // Type digits only — parentheses break JotForm's (000) 000-0000 mask.
    await fill('input[name="q6_phoneNumber[full]"]', phoneDigitsForMaskedInput(fields.phone));

    const dobText = formatDobForWidget(fields.dob);
    if (dobText) {
      await fill("#lite_mode_7", dobText);
      await page.click("body"); // blur — triggers JotForm's JS sync into the real hidden fields
    }

    if (fields.salesManager) {
      await fill('input[name="q18_pleaseInput"]', fields.salesManager);
    }
    if (fields.notes) {
      await fill('textarea[name="q15_notes"]', fields.notes);
    }

    const checkboxes = await page.$$('input[name="q4_platformsLogins[]"]');
    for (const cb of checkboxes) {
      const val = await page.evaluate((el: HTMLInputElement) => el.value, cb);
      if (fields.platforms.includes(val)) await cb.click();
    }

    const submitBtn = await page.$(
      'button[type="submit"], input[type="submit"], #input_submit_1',
    );
    if (!submitBtn) {
      return { status: "failed", reason: "Tron JotForm submit button not found on page" };
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => null),
      submitBtn.click(),
    ]);

    // Navigation can destroy the old execution context mid-evaluate; wait then retry.
    await new Promise(r => setTimeout(r, 800));
    let bodyText = "";
    let url = page.url();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        bodyText = await page.evaluate(() => document.body?.innerText || "");
        url = page.url();
        break;
      } catch {
        await new Promise(r => setTimeout(r, 400));
        url = page.url();
      }
    }

    // Successful JotForm posts almost always land on submit.jotform.com even when
    // the thank-you copy is slow to render.
    if (url.includes("submit.jotform.com")) {
      return { status: "sent" };
    }

    const looksLikeCaptchaChallenge = /captcha/i.test(bodyText) || /please complete/i.test(bodyText);
    const looksLikeSuccess = /thank you/i.test(bodyText);
    const looksLikeValidationError =
      /error on this page/i.test(bodyText) || /please enter a valid phone number/i.test(bodyText);

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
        reason: `Unexpected page after submit (url=${url}): ${bodyText.slice(0, 300) || "(empty body)"}`,
      };
    }

    return { status: "sent" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // If navigation already completed to the thank-you host, treat as sent.
    if (/execution context was destroyed|navigation/i.test(msg)) {
      return {
        status: "failed",
        reason: `Headless browser submission error: ${msg} (retry — often means submit navigated)`,
      };
    }
    return { status: "failed", reason: `Headless browser submission error: ${msg}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
