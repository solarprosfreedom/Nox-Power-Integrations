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
