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

/** True only when Sequifi has a complete home address in Illinois. Null/other states wait. */
export function hasIllinoisHomeAddress(user: HomeAddressFields): boolean {
  return isIllinoisHomeAddress(parseSequifiHomeAddress(user));
}

function zip5(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 5);
}

/**
 * Yes when Sequifi home and the ID are both Illinois.
 * If ZIP is on both sides, those 5 digits must match. Street does not need to match.
 */
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
  const idState = normalizeUsState(id.state ?? "");
  if (!home.state || !idState) return null;
  if (home.state !== "IL" || idState !== "IL") return false;
  const homeZip = zip5(home.zip);
  const idZip = zip5(id.zip);
  if (homeZip && idZip && homeZip !== idZip) return false;
  return true;
}
