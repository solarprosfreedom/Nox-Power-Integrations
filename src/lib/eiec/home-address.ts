import { normalizeUsState } from "@/lib/eiec/gpt-address";
import type { SequifiUserRecord } from "@/lib/onboarding/types";

export type SequifiHomeAddress = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
};

type HomeAddressFields = Pick<
  SequifiUserRecord,
  | "home_address"
  | "home_address_line_1"
  | "home_address_line_2"
  | "home_address_city"
  | "home_address_state"
  | "home_address_zip"
> & {
  raw?: Record<string, unknown>;
};

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "null") return null;
  return text;
}

const STREET_WORDS: Array<[RegExp, string]> = [
  [/\bstreet\b/g, "st"],
  [/\bavenue\b/g, "ave"],
  [/\broad\b/g, "rd"],
  [/\bdrive\b/g, "dr"],
  [/\bboulevard\b/g, "blvd"],
  [/\blane\b/g, "ln"],
  [/\bcourt\b/g, "ct"],
  [/\bcircle\b/g, "cir"],
  [/\bhighway\b/g, "hwy"],
  [/\bparkway\b/g, "pkwy"],
  [/\bplace\b/g, "pl"],
  [/\bterrace\b/g, "ter"],
  [/\bapartment\b/g, "apt"],
  [/\bsuite\b/g, "ste"],
  [/\bnorth\b/g, "n"],
  [/\bsouth\b/g, "s"],
  [/\beast\b/g, "e"],
  [/\bwest\b/g, "w"],
];

export function normalizeStreetLine(value: string): string {
  let text = String(value ?? "")
    .toLowerCase()
    .replace(/[#.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, replacement] of STREET_WORDS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, " ").trim();
}

function normalizeCity(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function zip5(value: string): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 5);
}

/** Structured Sequifi home address, or null until the rep finishes the profile step. */
export function parseSequifiHomeAddress(
  source: HomeAddressFields | null | undefined,
): SequifiHomeAddress | null {
  if (!source) return null;
  const raw = source.raw ?? {};
  const line1 = optionalText(source.home_address_line_1 ?? raw.home_address_line_1);
  const line2 = optionalText(source.home_address_line_2 ?? raw.home_address_line_2) ?? "";
  const city = optionalText(source.home_address_city ?? raw.home_address_city);
  const state = normalizeUsState(
    optionalText(source.home_address_state ?? raw.home_address_state) ?? "",
  );
  const zip = optionalText(source.home_address_zip ?? raw.home_address_zip) ?? "";
  const formattedGiven = optionalText(source.home_address ?? raw.home_address);
  if (!line1 || !city || !state) return null;

  const formatted =
    formattedGiven ||
    [line1, line2 || null, city, state, zip || null].filter(Boolean).join(", ");

  return { line1, line2, city, state, zip, formatted };
}

export function isIllinoisHomeAddress(
  address: SequifiHomeAddress | null | undefined,
): boolean {
  return address?.state === "IL";
}

/**
 * Scheduled EIEC gate: Illinois home address, or no address yet (check the ID later).
 * A filled non-IL home address is not an EIEC candidate.
 */
export function shouldQueueEiecCheck(user: HomeAddressFields): boolean {
  const home = parseSequifiHomeAddress(user);
  if (!home) return true;
  return isIllinoisHomeAddress(home);
}

export function sequifiAddressMatchesId(
  home: SequifiHomeAddress | null | undefined,
  id: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    readable?: boolean;
  } | null | undefined,
): boolean | null {
  if (!home || !id || id.readable === false) return null;
  if (!id.street || !id.city || !id.state) return null;
  if (normalizeStreetLine([home.line1, home.line2].filter(Boolean).join(" ")) !== normalizeStreetLine(id.street)) {
    return false;
  }
  if (normalizeCity(home.city) !== normalizeCity(id.city)) return false;
  if (home.state !== normalizeUsState(id.state)) return false;
  const homeZip = zip5(home.zip);
  const idZip = zip5(id.zip ?? "");
  if (homeZip && idZip && homeZip !== idZip) return false;
  return true;
}
