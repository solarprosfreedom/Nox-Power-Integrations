import { parseSequifiFields } from "@/lib/onboarding/sequifi-fields";

/** Selling market / state_code is IL — not a home address. */
export function isIllinoisSellingMarket(raw: Record<string, unknown>): boolean {
  const markets = parseSequifiFields(raw).markets;
  const blob = `${markets} ${String(raw.state_code ?? "")}`;
  return /\bIL\b|\bIllinois\b/i.test(blob);
}
