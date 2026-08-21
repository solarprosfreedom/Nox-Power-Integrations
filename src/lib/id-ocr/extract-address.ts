/** Parse a mailing address out of OCR text from a driver's license / state ID. */

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

const STREET_SUFFIX =
  /\b(ave|avenue|st|street|rd|road|dr|drive|ln|lane|blvd|ct|court|cir|circle|pkwy|hwy|way|pl|place|ter|terrace|trl|trail|loop|run)\.?\b/i;

const PHYSICAL_ATTR =
  /\b(hgt|wgt|eyes?|hair|iss|exp|dob|sex|class|endorsement|restriction|dd|donor)\b/i;

const JUNK_LINE =
  /^(sex|hgt|wgt|eyes?|dob|exp|class|end|rest|restr|dl|id|licen[cs]e|organ|donor|veteran|dd\b|rev\b|iss\b|hair|hgt\/wgt|endorsement|restriction|customer|document|sample|not a|duplicate|identif|california|illinois|identification|driver)/i;

const LABEL_LINE =
  /^(address|addr|residence|8\b|9\b|15\b)/i;

const ONE_LINE_ADDRESS =
  /^(\d{1,6}\s+[^,]+),\s*([^,]+),\s*([A-Z0-9]{2})\s+(\d{5}(?:-\d{4})?)$/i;

const CITY_STATE_ZIP =
  /^(.+?)[,\s]+([A-Z0-9]{2})\s+(\d{5}(?:-\d{4})?)$/i;

const STATE_ZIP_ONLY =
  /^([A-Z0-9]{2})\s+(\d{5}(?:-\d{4})?)$/i;

const STREET_THEN_CITY =
  /^(\d{1,6}\s+.+?(?:ave|avenue|st|street|rd|road|dr|drive|ln|lane|blvd|ct|court|way|cir|pkwy)\.?)\s*,\s*([A-Za-z][A-Za-z .'-]+)$/i;

const PHONE_OR_URL = /www\.|https?:\/\/|\+\d|\d{3}[-.\s]\d{3}[-.\s]\d{4}/i;

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

function looksLikeStreet(line: string): boolean {
  if (!line) return false;
  if (PHYSICAL_ATTR.test(line) || PHONE_OR_URL.test(line)) return false;
  return /^\d{1,6}\s+/.test(line) && STREET_SUFFIX.test(line);
}

function isJunk(line: string): boolean {
  if (!line) return true;
  if (line.length < 2) return true;
  if (PHYSICAL_ATTR.test(line) && !looksLikeStreet(line)) return true;
  if (JUNK_LINE.test(line) && !looksLikeStreet(line) && !CITY_STATE_ZIP.test(line)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(line)) return true;
  if (/^[A-Z0-9]{8,}$/.test(line) && /\d/.test(line) && !looksLikeStreet(line)) return true;
  return false;
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

function parseOneLineAddress(line: string): ExtractedIdAddress | null {
  const match = cleanLine(line).match(ONE_LINE_ADDRESS);
  if (!match) return null;
  const state = fixOcrState(match[3] ?? "");
  if (!US_STATES.has(state)) return null;
  if (!looksLikeStreet(match[1] ?? "")) return null;
  return formatAddress({
    street: titleCase(match[1] ?? ""),
    city: titleCase(match[2] ?? ""),
    state,
    zip: match[4] ?? "",
  });
}

function parseCityStateZip(line: string): { city: string; state: string; zip: string } | null {
  const match = cleanLine(line).match(CITY_STATE_ZIP);
  if (!match) return null;
  const state = fixOcrState(match[2] ?? "");
  if (!US_STATES.has(state)) return null;
  return { city: titleCase(match[1] ?? ""), state, zip: match[3] ?? "" };
}

function parseLooseStreetCity(line: string): ExtractedIdAddress | null {
  if (PHONE_OR_URL.test(line) || PHYSICAL_ATTR.test(line)) return null;
  const match = line.match(STREET_THEN_CITY);
  if (!match) return null;
  if (CITY_STATE_ZIP.test(line) || ONE_LINE_ADDRESS.test(line)) return null;
  return formatAddress({
    street: titleCase(match[1] ?? ""),
    city: titleCase(match[2] ?? ""),
    state: "",
    zip: "",
  });
}

export function extractAddressFromOcrText(text: string): ExtractedIdAddress | null {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  const usable: string[] = [];
  for (const line of lines) {
    if (LABEL_LINE.test(line) && !looksLikeStreet(line) && !CITY_STATE_ZIP.test(line)) continue;
    if (isJunk(line)) continue;
    usable.push(line);
  }

  for (const line of usable) {
    const oneLine = parseOneLineAddress(line);
    if (oneLine) return oneLine;
  }

  for (let i = 0; i < usable.length; i++) {
    const parsed = parseCityStateZip(usable[i]!);
    if (!parsed) continue;

    if (parsed.city.includes(",")) {
      const oneLine = parseOneLineAddress(`${parsed.city}, ${parsed.state} ${parsed.zip}`);
      if (oneLine) return oneLine;
    }

    const prev = usable[i - 1] ?? "";
    const prev2 = usable[i - 2] ?? "";
    let street = looksLikeStreet(prev) ? prev : "";
    if (!street && looksLikeStreet(prev2)) street = prev2;
    if (!street) continue;
    return formatAddress({ street: titleCase(street), ...parsed });
  }

  for (let i = 0; i < usable.length; i++) {
    const stateZip = usable[i]!.match(STATE_ZIP_ONLY);
    if (!stateZip) continue;
    const state = fixOcrState(stateZip[1] ?? "");
    if (!US_STATES.has(state)) continue;
    const city = usable[i - 1] ?? "";
    const street = usable[i - 2] ?? "";
    if (!city || !looksLikeStreet(street) || CITY_STATE_ZIP.test(city)) continue;
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
