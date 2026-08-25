import { env } from "@/lib/env";

export type GptIdAddress = {
  readable: boolean;
  street: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
  documentType: string;
};

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
  };
  const street = String(parsed.street ?? "").trim();
  const city = String(parsed.city ?? "").trim();
  const state = String(parsed.state ?? "").trim().toUpperCase();
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
                "Extract ONLY the mailing address if visible. " +
                "Return JSON: document_type, street, city, state, zip, formatted, readable. " +
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
