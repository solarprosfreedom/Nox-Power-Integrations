import { env } from "@/lib/env";

export type GptIdAddress = {
  readable: boolean;
  street: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
  documentType: string;
  issuedState: string;
};

const STATE_NAMES: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

export function normalizeUsState(value: string): string {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return STATE_NAMES[raw] ?? raw;
}

/** True when the ID issuing state matches the address printed on the ID. */
export function addressMatchesId(issuedState: string, addressState: string): boolean | null {
  const issued = normalizeUsState(issuedState);
  const address = normalizeUsState(addressState);
  if (!issued || !address) return null;
  return issued === address;
}

export function parseGptAddressJson(text: string): GptIdAddress {
  const cleaned = String(text ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as {
    readable?: boolean;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    formatted?: string;
    document_type?: string;
    issued_state?: string;
    id_state?: string;
  };
  const street = String(parsed.street ?? "").trim();
  const city = String(parsed.city ?? "").trim();
  const state = normalizeUsState(String(parsed.state ?? ""));
  const zip = String(parsed.zip ?? "").trim();
  const formatted =
    String(parsed.formatted ?? "").trim() ||
    [street, city, state, zip].filter(Boolean).join(", ");
  const readable = parsed.readable !== false && Boolean(street && city && state);
  return {
    readable,
    street,
    city,
    state,
    zip,
    formatted,
    documentType: String(parsed.document_type ?? "").trim(),
    issuedState: normalizeUsState(String(parsed.issued_state ?? parsed.id_state ?? "")),
  };
}

export async function extractAddressFromIdImage(
  bytes: Buffer,
  mimeType: string,
): Promise<GptIdAddress> {
  const key = env.openaiApiKey?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set.");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "This is a US driver's license, state ID, or passport. " +
                "Extract the mailing address if visible, and the US state that issued the DL/ID. " +
                "Return JSON: document_type, issued_state, street, city, state, zip, formatted, readable. " +
                "issued_state must be a 2-letter code. For a passport, leave issued_state empty. " +
                "If there is no street address or it is unreadable, set readable=false and empty address fields. " +
                "Do not return DL number, DOB, or other PII.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${bytes.toString("base64")}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    }),
  });

  const json = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `OpenAI vision failed (${res.status})`);
  }
  const text = json.choices?.[0]?.message?.content ?? "";
  return parseGptAddressJson(text);
}
