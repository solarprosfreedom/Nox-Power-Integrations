/**
 * Submits the SolQ LeadConnector "Employee Submission" form via headless Chromium.
 *
 * Plain POSTs to LeadConnector are blocked by Cloudflare; driving the published
 * widget (same stack as Tron/Empower) produces a real browser session.
 *
 * Form: https://msg.black33.io/widget/form/zEAvzxnz1cl1TTDNNMSz
 * Vue-multiselect picklists + Vue datepicker; Rep Card / shirt / coat / headshot
 * intentionally left blank per SOP.
 */
import { launchHeadlessBrowser, type HeadlessBrowser } from "@/lib/onboarding/headless-browser";
import { formatPhoneForMaskedInput } from "@/lib/onboarding/phone";
import type { SolqFormFields } from "@/lib/onboarding/solq-form";

export interface BrowserSubmitResult {
  status: "sent" | "failed";
  reason?: string;
}

function formatPhone(raw: string): string {
  return formatPhoneForMaskedInput(raw);
}

/** MM/DD/YYYY for the Vue datepicker display input. */
function formatStartDateForPicker(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

export async function submitSolqFormViaBrowser(
  fields: SolqFormFields,
  formUrl: string,
): Promise<BrowserSubmitResult> {
  let browser: HeadlessBrowser | null = null;
  try {
    browser = await launchHeadlessBrowser();
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(25000);
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(formUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector("#_builder-form, form[name='builder-form'], input[name='first_name']", {
      timeout: 20000,
    });

    async function sleep(ms: number): Promise<void> {
      await new Promise(r => setTimeout(r, ms));
    }

    async function fillByName(name: string, value: string): Promise<void> {
      if (!value) return;
      const selector = `input[name="${name}"], textarea[name="${name}"]`;
      const el = await page.$(selector);
      if (!el) throw new Error(`SolQ form field not found: ${name}`);
      await page.evaluate((sel: string) => {
        const node = document.querySelector(sel) as HTMLInputElement | null;
        if (!node) return;
        node.focus();
        node.value = "";
      }, selector);
      await el.type(value, { delay: 8 });
    }

    async function selectMultiselect(fieldName: string, optionText: string): Promise<void> {
      const want = optionText.trim().toLowerCase();
      const opened = await page.evaluate((name: string) => {
        const input = document.querySelector(`input[name="${name}"]`) as HTMLElement | null;
        const root =
          (input?.closest(".multiselect") as HTMLElement | null) ||
          (document.querySelector(`[data-qid="${name}"] .multiselect`) as HTMLElement | null);
        if (!root) return false;
        const searchable = root.querySelector(".multiselect__input, input") as HTMLInputElement | null;
        (searchable || root).click();
        if (searchable) {
          searchable.focus();
          searchable.value = "";
        }
        return true;
      }, fieldName);
      if (!opened) throw new Error(`SolQ multiselect not found: ${fieldName}`);
      await sleep(400);

      // Type to filter (many LeadConnector multiselects are searchable).
      const searchSel = `input[name="${fieldName}"], [data-qid="${fieldName}"] .multiselect__input, .multiselect--active .multiselect__input`;
      const searchEl = await page.$(searchSel);
      if (searchEl) {
        await searchEl.click({ clickCount: 3 }).catch(() => null);
        await page.keyboard.type(optionText, { delay: 20 });
        await sleep(350);
      }

      const result = await page.evaluate((opt: string) => {
        const want = opt.trim().toLowerCase();
        const options = [
          ...document.querySelectorAll(
            ".multiselect__content-wrapper .multiselect__option, .multiselect__element, .multiselect__option",
          ),
        ].filter(o => {
          const el = o as HTMLElement;
          const style = getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden" && !el.classList.contains("multiselect__option--disabled");
        });
        const texts = options.map(o => (o.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
        const el = options.find(o => {
          const t = (o.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          return t === want || t.endsWith(want) || t.includes(want) || want.includes(t);
        }) as HTMLElement | undefined;
        if (!el) return { ok: false as const, texts };
        el.click();
        return { ok: true as const, texts };
      }, optionText);

      if (!result.ok) {
        // Last resort: Enter on first highlighted option after typing.
        await page.keyboard.press("Enter");
        await sleep(250);
        const selected = await page.evaluate((name: string, opt: string) => {
          const input = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
          const root = input?.closest(".multiselect") as HTMLElement | null;
          const tags = root
            ? [...root.querySelectorAll(".multiselect__tag, .multiselect__single")]
                .map(t => (t.textContent || "").replace(/\s+/g, " ").trim().toLowerCase())
            : [];
          const want = opt.trim().toLowerCase();
          return tags.some(t => t === want || t.includes(want));
        }, fieldName, optionText);
        if (!selected) {
          throw new Error(
            `SolQ option not found for ${fieldName}: ${optionText}` +
              (result.texts.length ? ` (saw: ${result.texts.slice(0, 10).join(" | ")})` : ""),
          );
        }
      }
      await sleep(200);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
      });
      await page.keyboard.press("Escape").catch(() => null);
      await sleep(150);
    }

    await fillByName("eMW1Pi3oyTomDObJ7TLo", fields.submitterName);

    for (const market of fields.markets) {
      await selectMultiselect("EpP6K1HAaZPUg08PvG5h", market);
    }

    await fillByName("first_name", fields.firstName);
    await fillByName("last_name", fields.lastName);
    await fillByName("phone", formatPhone(fields.phone));
    await fillByName("email", fields.email);

    await selectMultiselect("3MM7XWzBIaRDwGVZWVnz", fields.position);
    await selectMultiselect("2G4ovVMmMIswT4gb7EYi", fields.employmentType);

    // Date picker input has no name; use data-q / aria-label.
    const dateSelector =
      'input[data-q="start_or_arrival_date"], input[aria-label="Start or arrival date*"], .vdpComponent input[type="text"]';
    const dateEl = await page.$(dateSelector);
    if (!dateEl) throw new Error("SolQ start date field not found");
    await page.evaluate((sel: string) => {
      const node = document.querySelector(sel) as HTMLInputElement | null;
      if (!node) return;
      node.focus();
      node.value = "";
    }, dateSelector);
    await dateEl.type(formatStartDateForPicker(fields.startDate), { delay: 15 });
    await page.keyboard.press("Enter");
    await sleep(200);

    await selectMultiselect("6taXJWg4qSU9VFsS3Ulc", fields.internalOrOutside);
    await sleep(400); // Outside Org Name appears via conditional logic
    await fillByName("V8kqocw7xl1rt6SPucCl", fields.outsideOrgName);
    await fillByName("hEEqQj3QcefYnalX5iCw", fields.notes);

    // Rep Card / shirt / coat / headshot intentionally blank.

    const submitClicked = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button, input[type=submit], [role=button]")];
      const submit = buttons.find(b => /^(submit)$/i.test((b.textContent || (b as HTMLInputElement).value || "").trim()));
      if (!submit) return false;
      (submit as HTMLElement).click();
      return true;
    });
    if (!submitClicked) {
      return { status: "failed", reason: "SolQ form Submit button not found" };
    }

    // Wait for thank-you / success / error state
    const deadline = Date.now() + 45000;
    let bodyText = "";
    while (Date.now() < deadline) {
      await sleep(500);
      bodyText = await page.evaluate(() => document.body.innerText || "");
      if (/thank you|submission received|successfully submitted|form submitted/i.test(bodyText)) {
        return { status: "sent" };
      }
      if (/captcha|recaptcha|turnstile|attention required|cloudflare/i.test(bodyText)) {
        return {
          status: "failed",
          reason: "SolQ form blocked by CAPTCHA/Cloudflare — retry or submit manually",
        };
      }
      if (/this field is required|please complete|is required/i.test(bodyText) && /error|invalid/i.test(bodyText)) {
        return {
          status: "failed",
          reason: `SolQ form validation error: ${bodyText.slice(0, 300)}`,
        };
      }
    }

    // Some GHL widgets replace the form without "thank you" wording — treat cleared form as success.
    const stillHasFirstName = await page.evaluate(() => {
      const el = document.querySelector('input[name="first_name"]') as HTMLInputElement | null;
      return Boolean(el && el.offsetParent !== null && el.value);
    });
    if (!stillHasFirstName && /employee submission|rep onboarding/i.test(bodyText) === false) {
      return { status: "sent" };
    }

    return {
      status: "failed",
      reason: `Unexpected SolQ form page after submit: ${bodyText.slice(0, 400)}`,
    };
  } catch (e) {
    return {
      status: "failed",
      reason: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
