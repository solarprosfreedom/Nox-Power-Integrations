/**
 * Submits the Empower "New Rep Request" Typeform via headless Chromium.
 *
 * Typeform's public API can retrieve responses but cannot create them, so we
 * drive the published form the same way a human would (welcome → fields →
 * thank-you). Runtime mirrors Tron: @sparticuz/chromium + puppeteer-core on
 * Vercel; full puppeteer locally.
 *
 * Live form notes (https://form.typeform.com/to/UvpPrheO):
 * - Free-form navigation stacks questions; inactive blocks have `inert` +
 *   opacity 0 and cannot be clicked until the prior question is OKed.
 * - Multi-select OK advances the active block; final screen uses Submit /
 *   Cmd+Enter.
 */
import type { EmpwrTypeformFields } from "@/lib/onboarding/empwr-typeform";

export interface BrowserSubmitResult {
  status: "sent" | "failed";
  reason?: string;
}

function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

type PuppeteerPage = {
  goto: (url: string, opts?: object) => Promise<unknown>;
  setDefaultNavigationTimeout: (ms: number) => void;
  setDefaultTimeout: (ms: number) => void;
  setViewport: (v: { width: number; height: number }) => Promise<unknown>;
  waitForSelector: (s: string, opts?: object) => Promise<unknown>;
  click: (s: string) => Promise<void>;
  $: (s: string) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  $$: (s: string) => Promise<any[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
  evaluate: (fn: any, ...args: any[]) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  keyboard: {
    press: (key: string) => Promise<void>;
    down: (key: string) => Promise<void>;
    up: (key: string) => Promise<void>;
  };
  focus: (s: string) => Promise<void>;
};

type PuppeteerBrowser = {
  newPage: () => Promise<PuppeteerPage>;
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

function formatPhoneForTypeform(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw.trim();
}

export async function submitEmpwrTypeformViaBrowser(
  fields: EmpwrTypeformFields,
  formUrl: string,
): Promise<BrowserSubmitResult> {
  let browser: PuppeteerBrowser | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(25000);
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(formUrl, { waitUntil: "networkidle2" });

    async function sleep(ms: number): Promise<void> {
      await new Promise(r => setTimeout(r, ms));
    }

    async function fillSelector(selector: string, value: string): Promise<void> {
      await page.waitForSelector(selector, { visible: true, timeout: 15000 });
      const el = await page.$(selector);
      if (!el) throw new Error(`Typeform field not found: ${selector}`);
      await el.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await el.type(value, { delay: 12 });
      await sleep(150);
    }

    /** Wait until a non-inert, visible blocktype contains `substr`. */
    async function waitActiveQuestion(substr: string, timeoutMs = 20000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const ok = await page.evaluate((s: string) => {
          const needle = s.toLowerCase();
          const blocks = Array.from(
            document.querySelectorAll('[data-qa*="blocktype"]'),
          ) as HTMLElement[];
          return blocks.some(b => {
            if (b.hasAttribute("inert")) return false;
            if (getComputedStyle(b).opacity === "0") return false;
            return (b.innerText || "").toLowerCase().includes(needle);
          });
        }, substr);
        if (ok) return;
        await sleep(200);
      }
      throw new Error(`Timed out waiting for active question: ${substr}`);
    }

    /** Click OK / Continue on the currently active (non-inert) block. */
    async function clickActiveOk(): Promise<void> {
      const clicked = await page.evaluate(() => {
        const blocks = Array.from(
          document.querySelectorAll('[data-qa*="blocktype"]'),
        ) as HTMLElement[];
        const active = blocks.find(
          b => !b.hasAttribute("inert") && getComputedStyle(b).opacity !== "0",
        );
        const ok = active?.querySelector(
          'button[data-qa*="ok-button-visible"], button[data-qa*="continue"], button',
        ) as HTMLElement | null;
        // Prefer a button whose text is OK / Continue / Submit
        const buttons = active
          ? (Array.from(active.querySelectorAll("button")) as HTMLElement[])
          : [];
        const byText = buttons.find(b =>
          /^(ok|continue|submit)$/i.test((b.innerText || "").trim()),
        );
        const target = byText || ok;
        if (target) {
          target.click();
          return true;
        }
        return false;
      });
      if (!clicked) await page.keyboard.press("Enter");
      await sleep(1100);
    }

    /**
     * Click a choice inside a non-inert block only. Inactive stacked blocks are
     * `inert` and silently ignore clicks.
     */
    async function selectChoice(
      label: string,
      opts?: { requireChecked?: boolean },
    ): Promise<void> {
      const want = label.trim().toLowerCase();
      const requireChecked = opts?.requireChecked ?? false;

      const handles = await page.$$('button[role="radio"], button[role="checkbox"]');
      let target: (typeof handles)[number] | null = null;
      let role = "";
      for (const h of handles) {
        const meta = await h.evaluate(btn => {
          const lines = (btn.innerText || "")
            .split("\n")
            .map(s => s.trim())
            .filter(Boolean);
          const labelText = (lines[lines.length - 1] || "").toLowerCase();
          const block = btn.closest('[data-qa*="blocktype"]') as HTMLElement | null;
          const inert = Boolean(block?.hasAttribute("inert"));
          const opacity = block ? getComputedStyle(block).opacity : "1";
          const r = btn.getBoundingClientRect();
          return {
            labelText,
            w: r.width,
            h: r.height,
            inert,
            opacity,
            role: btn.getAttribute("role") || "",
          };
        });
        if (meta.inert || meta.opacity === "0" || meta.w < 2 || meta.h < 2) continue;
        if (meta.labelText === want || meta.labelText.startsWith(want)) {
          target = h;
          role = meta.role;
          break;
        }
      }
      if (!target) throw new Error(`Typeform choice not found (active): ${label}`);

      await target.click({ delay: 40 });
      await sleep(350);

      if (requireChecked || role === "checkbox") {
        const checked = await target.evaluate(btn => btn.getAttribute("aria-checked"));
        if (checked !== "true") {
          throw new Error(`Typeform choice did not stay selected: ${label}`);
        }
      }
    }

    async function selectChoices(labels: string[]): Promise<void> {
      for (const label of labels) {
        await selectChoice(label, { requireChecked: true });
      }
    }

    // —— Welcome ——
    await page.waitForSelector('[data-qa="start-button"]', { visible: true, timeout: 20000 });
    await sleep(400);
    await page.click('[data-qa="start-button"]');
    await page.waitForSelector('input[name="given-name"]', { visible: true, timeout: 20000 });

    // —— Basic Info ——
    await fillSelector('input[name="given-name"]', fields.firstName);
    await fillSelector('input[name="family-name"]', fields.lastName);
    await fillSelector('[data-qa="phone-number-input"]', formatPhoneForTypeform(fields.phone));
    await fillSelector('input[name="email"]', fields.email);
    await page.focus('input[name="email"]');
    await page.keyboard.press("Enter");
    await sleep(1000);

    // —— Team ID ——
    await fillSelector('input[placeholder*="Type your answer"]', fields.teamId);
    await page.keyboard.press("Enter");
    await sleep(1000);

    // —— New to Empower ——
    await selectChoice(fields.newToEmpower);
    await sleep(800);

    // —— Access Needed ——
    await waitActiveQuestion("access needed");
    await selectChoice(fields.accessNeeded);
    await sleep(800);

    // —— Home services ——
    await waitActiveQuestion("home services");
    await selectChoices(fields.homeServices);
    await clickActiveOk();

    // —— Financiers ——
    await waitActiveQuestion("finance products");
    await selectChoices(fields.financiers);
    await clickActiveOk();

    // —— Consent ——
    await waitActiveQuestion("consent to receive");
    await selectChoice("Yes");
    await sleep(800);

    // —— States ——
    await waitActiveQuestion("states do you plan");
    await selectChoices(fields.states);
    await clickActiveOk();

    // —— HIS (CA only; form jumps here when CA selected) ——
    if (fields.his) {
      await waitActiveQuestion("his license number");
      await fillSelector('input[placeholder*="Type your answer"]', fields.his.licenseNumber);
      await page.keyboard.press("Enter");
      await sleep(900);

      await waitActiveQuestion("issue date");
      await fillDate(page, fields.his.issueDate, sleep);
      await page.keyboard.press("Enter");
      await sleep(900);

      await waitActiveQuestion("expiration date");
      await fillDate(page, fields.his.expirationDate, sleep);
      await page.keyboard.press("Enter");
      await sleep(900);

      await waitActiveQuestion("associate your his license");
      await selectChoice("Yes.");
      await sleep(800);
    }

    // —— Closing statement → Submit (Cmd/Ctrl+Enter or Submit button) ——
    await sleep(800);
    const submitted = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button")) as HTMLElement[];
      const submit = buttons.find(b => /^(submit)$/i.test((b.innerText || "").trim()));
      if (submit) {
        submit.click();
        return true;
      }
      return false;
    });
    if (!submitted) {
      // Typeform shows "press Cmd ⌘ + Enter" on the final statement.
      const meta = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.down(meta);
      await page.keyboard.press("Enter");
      await page.keyboard.up(meta);
    }
    await sleep(3000);

    const bodyText: string = await page.evaluate(() => document.body.innerText);
    const looksLikeSuccess =
      /welcome to the empower/i.test(bodyText) ||
      /all done/i.test(bodyText) ||
      /thanks for your time/i.test(bodyText) ||
      /jobflo/i.test(bodyText) ||
      /tools up and running/i.test(bodyText);

    if (!looksLikeSuccess) {
      return {
        status: "failed",
        reason: `Unexpected Typeform page after submit: ${bodyText.slice(0, 400)}`,
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

async function fillDate(
  page: PuppeteerPage,
  isoDate: string,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid HIS date (want YYYY-MM-DD): ${isoDate}`);
  const [, year, month, day] = m;

  const monthInput = await page.$('input[placeholder*="MM"], input[aria-label*="month" i]');
  const dayInput = await page.$('input[placeholder*="DD"], input[aria-label*="day" i]');
  const yearInput = await page.$('input[placeholder*="YYYY"], input[aria-label*="year" i]');

  if (monthInput && dayInput && yearInput) {
    await monthInput.click({ clickCount: 3 });
    await monthInput.type(month, { delay: 10 });
    await dayInput.click({ clickCount: 3 });
    await dayInput.type(day, { delay: 10 });
    await yearInput.click({ clickCount: 3 });
    await yearInput.type(year, { delay: 10 });
    await sleep(200);
    return;
  }

  const any = await page.$('input[type="date"], input[placeholder*="Type your answer"]');
  if (!any) throw new Error(`Date input not found for ${isoDate}`);
  await any.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await any.type(isoDate, { delay: 12 });
  await sleep(200);
}
