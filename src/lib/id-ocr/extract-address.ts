/** Parse a US mailing address out of OCR text from a driver's license / state ID. */

export interface ExtractedIdAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
}

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA",
  "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS",
  "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
]);

const JUNK_LINE =
  /^(sex|hgt|wgt|eyes?|dob|exp|class|end|rest|restr|dl|id|licen[cs]e|organ|donor|veteran|dd\b|rev\b|iss\b|hair|hgt\/wgt|endorsement|restriction|customer|document|sample|not a|duplicate|identif)/i;

const LABEL_LINE =
  /^(address|addr|residence|8\b|9\b|15\b)/i;

const CITY_STATE_ZIP =
  /^(.+?)[,\s]+([A-Z0-9]{2})\s+(\d{5}(?:-\d{4})?)$/i;

const STATE_ZIP_ONLY =
  /^([A-Z0-9]{2})\s+(\d{5}(?:-\d{4})?)$/i;

const STREET_HINT =
  /\d{1,6}.+|apt|unit|ste\b|suite|#\d|ave|avenue|st\b|street|rd\b|road|dr\b|drive|ln\b|lane|blvd|ct\b|court|way|cir|pkwy|hwy|route|rt\s?\d|po box/i;

function fixOcrState(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (US_STATES.has(s)) return s;
  const aliases: Record<string, string> = {
    "1L": "IL",
    I1: "IL",
    LL: "IL",
    II: "IL",
    "1I": "IL",
    I7: "IL",
  };
  return aliases[s] ?? s;
}

function cleanLine(line: string): string {
  return line
    .replace(/[|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,:;\-]+|[\s,:;\-]+$/g, "")
    .trim();
}

function isJunk(line: string): boolean {
  if (!line) return true;
  if (line.length < 2) return true;
  if (JUNK_LINE.test(line)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(line)) return true;
  if (/^[A-Z0-9]{8,}$/.test(line) && /\d/.test(line) && !STREET_HINT.test(line)) return true;
  return false;
}

function parseCityStateZip(line: string): { city: string; state: string; zip: string } | null {
  const cleaned = cleanLine(line);
  const withComma = cleaned.match(CITY_STATE_ZIP);
  if (withComma) {
    const state = fixOcrState(withComma[2] ?? "");
    if (!US_STATES.has(state)) return null;
    return { city: titleCase(withComma[1] ?? ""), state, zip: withComma[3] ?? "" };
  }
  return null;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map(word => (word.length <= 2 ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}

function formatAddress(parts: Omit<ExtractedIdAddress, "formatted">): ExtractedIdAddress {
  const street = parts.street.trim();
  const city = parts.city.trim();
  const cityLine = [city, [parts.state, parts.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const formatted = [street, cityLine].filter(Boolean).join(", ");
  return { ...parts, street, city, formatted };
}

const PHONE_OR_URL = /www\.|https?:\/\/|\+\d|\d{3}[-.\s]\d{3}[-.\s]\d{4}/i;

const STREET_THEN_CITY =
  /^(\d{1,6}\s+.+?(?:ave|avenue|st|street|rd|road|dr|drive|ln|lane|blvd|ct|court|way|cir|pkwy)\.?)\s*,\s*([A-Za-z][A-Za-z .'-]+)$/i;

function parseLooseStreetCity(line: string): ExtractedIdAddress | null {
  if (PHONE_OR_URL.test(line)) return null;
  const match = line.match(STREET_THEN_CITY);
  if (match) {
    return formatAddress({
      street: titleCase(match[1] ?? ""),
      city: titleCase(match[2] ?? ""),
      state: "",
      zip: "",
    });
  }
  if (/^\d{1,6}\s+\S+/.test(line) && STREET_HINT.test(line) && !CITY_STATE_ZIP.test(line) && !STATE_ZIP_ONLY.test(line)) {
    return formatAddress({ street: titleCase(line), city: "", state: "", zip: "" });
  }
  return null;
}

export function extractAddressFromOcrText(text: string): ExtractedIdAddress | null {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  const usable: string[] = [];
  for (const line of lines) {
    if (LABEL_LINE.test(line) && !STREET_HINT.test(line) && !CITY_STATE_ZIP.test(line)) continue;
    if (isJunk(line)) continue;
    usable.push(line);
  }

  for (let i = 0; i < usable.length; i++) {
    const parsed = parseCityStateZip(usable[i]!);
    if (!parsed) continue;
    const prev = usable[i - 1] ?? "";
    const prev2 = usable[i - 2] ?? "";
    let street = prev;
    if (prev && !STREET_HINT.test(prev) && STREET_HINT.test(prev2)) {
      street = `${prev2} ${prev}`.trim();
    }
    if (!street || CITY_STATE_ZIP.test(street) || STATE_ZIP_ONLY.test(street)) {
      continue;
    }
    return formatAddress({ street: titleCase(street), ...parsed });
  }

  for (let i = 0; i < usable.length; i++) {
    const stateZip = usable[i]!.match(STATE_ZIP_ONLY);
    if (!stateZip) continue;
    const state = fixOcrState(stateZip[1] ?? "");
    if (!US_STATES.has(state)) continue;
    const city = usable[i - 1] ?? "";
    const street = usable[i - 2] ?? "";
    if (!city || !street || CITY_STATE_ZIP.test(city)) continue;
    return formatAddress({
      street: titleCase(street),
      city: titleCase(city),
      state,
      zip: stateZip[2] ?? "",
    });
  }

  for (const line of usable) {
    const loose = parseLooseStreetCity(line);
    if (loose) return loose;
  }

  return null;
}
