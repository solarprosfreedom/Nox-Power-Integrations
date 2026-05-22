import { terrosSuccess } from "@/lib/sync/terros-accounts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastTerrosRequestAt = 0;
const MIN_TERROS_GAP_MS = 350;

export function isTerrosRateLimitError(text: string, status: number): boolean {
  if (status === 429) return true;
  return text.includes("TooManyRequests") || text.includes("Too many request");
}

/** Space out Terros calls to avoid burst rate limits during bulk sync. */
export async function throttleTerrosRequest(minGapMs = MIN_TERROS_GAP_MS): Promise<void> {
  const wait = lastTerrosRequestAt + minGapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastTerrosRequestAt = Date.now();
}

export async function postTerros(
  base: string,
  key: string,
  path: string,
  body: unknown,
  opts?: { retries?: number; minGapMs?: number },
): Promise<{ ok: boolean; text: string; status: number }> {
  const retries = opts?.retries ?? 5;
  const minGapMs = opts?.minGapMs ?? MIN_TERROS_GAP_MS;
  let lastText = "";
  let lastStatus = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttleTerrosRequest(minGapMs);
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${key}` },
      body: JSON.stringify(body),
    });
    lastText = await res.text();
    lastStatus = res.status;

    if (!isTerrosRateLimitError(lastText, lastStatus)) {
      return { ok: res.ok && terrosSuccess(lastText), text: lastText, status: lastStatus };
    }
    if (attempt < retries) {
      await sleep(1000 * 2 ** attempt);
    }
  }

  return { ok: false, text: lastText, status: lastStatus };
}
