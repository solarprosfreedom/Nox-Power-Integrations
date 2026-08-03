import { env } from "@/lib/env";

/** NANP area code (NXX) cannot start with 0 or 1 — the failure mode for Test Onboarding `125…`. */
export function isValidUsNanpDigits(digits: string): boolean {
  return /^\d{10}$/.test(digits) && !/^[01]/.test(digits[0] ?? "");
}

/**
 * Normalize a Sequifi/mobile phone to 10 NANP digits.
 * Strips a leading country `1` when present. Invalid / placeholder numbers
 * (e.g. Test Onboarding `1254564564`) fall back to ONBOARDING_DEFAULT_PHONE.
 */
export function normalizeUsPhoneDigits(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (isValidUsNanpDigits(digits)) return digits;

  const fallback = (env.onboardingDefaultPhone ?? "4805550199").replace(/\D/g, "");
  const fb =
    fallback.length === 11 && fallback.startsWith("1") ? fallback.slice(1) : fallback;
  return isValidUsNanpDigits(fb) ? fb : "4805550199";
}

/** JotForm / Typeform style: (480) 555-0199 */
export function formatPhoneForMaskedInput(raw: string | null | undefined): string {
  const digits = normalizeUsPhoneDigits(raw);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
