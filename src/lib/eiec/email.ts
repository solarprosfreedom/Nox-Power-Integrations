export const EIEC_DEFAULT_TO = "noxpwr@gmail.com";
export const EIEC_ADMIN_TO = "admin@noxpwr.com";

export function eiecEmailRecipients(configured?: string): string[] {
  const fromEnv = String(configured ?? "")
    .split(/[,;]+/)
    .map((address) => address.trim())
    .filter(Boolean);
  const recipients = fromEnv.length ? fromEnv : [EIEC_DEFAULT_TO];
  if (!recipients.some((address) => address.toLowerCase() === EIEC_ADMIN_TO)) {
    recipients.push(EIEC_ADMIN_TO);
  }
  return recipients;
}

export function formatEiecResultEmail(input: {
  name: string;
  eligible: boolean;
  addressMatchesId?: boolean | null;
}): string {
  const match =
    input.addressMatchesId === true ? "yes" : input.addressMatchesId === false ? "no" : "n/a";
  return [
    `Name of rep: ${input.name}`,
    `Illinois Eligible: ${input.eligible ? "yes" : "no"}`,
    `Address matches ID: ${match}`,
  ].join("\n");
}
