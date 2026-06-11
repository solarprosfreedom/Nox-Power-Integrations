import { config } from "dotenv";
import { writeFileSync } from "fs";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const TAPE_API_BASE = "https://api.tapeapp.com";
const CUSTOMERS_VIEW_ID = 91142;
const PAGE_LIMIT = 50;
const OUTPUT_FILE = resolve(__dirname, "../customers.json");

type TapeListResponse = {
  total?: number;
  cursor?: string;
  records?: unknown[];
  error_message?: string;
};

async function fetchViewPage(viewId: number, cursor?: string): Promise<TapeListResponse> {
  const apiKey = process.env.TAPE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing TAPE_API_KEY in .env.local");
  }

  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) params.set("cursor", cursor);

  const url = `${TAPE_API_BASE}/v1/record/view/${viewId}?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const body = (await res.json()) as TapeListResponse;
  if (!res.ok) {
    throw new Error(body.error_message ?? `Tape API HTTP ${res.status}`);
  }
  return body;
}

async function fetchAllCustomers(viewId: number): Promise<unknown[]> {
  const all: unknown[] = [];
  let cursor: string | undefined;

  do {
    const page = await fetchViewPage(viewId, cursor);
    const batch = page.records ?? [];
    if (batch.length === 0) break;

    all.push(...batch);
    console.log(`Fetched ${batch.length} records (${all.length}/${page.total ?? "?"} total)`);

    if (page.total != null && all.length >= page.total) break;
    cursor = page.cursor;
  } while (cursor);

  return all;
}

async function main() {
  console.log(`Fetching Customers view ${CUSTOMERS_VIEW_ID}...`);
  const records = await fetchAllCustomers(CUSTOMERS_VIEW_ID);

  const output = {
    fetched_at: new Date().toISOString(),
    view_id: CUSTOMERS_VIEW_ID,
    total: records.length,
    records,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8");
  console.log(`Saved ${records.length} records to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
