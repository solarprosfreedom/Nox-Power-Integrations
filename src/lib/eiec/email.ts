export function formatEiecResultEmail(input: {
  name: string;
  eligible: boolean;
}): string {
  return [
    `Name of rep: ${input.name}`,
    `Illinois Eligible: ${input.eligible ? "yes" : "no"}`,
  ].join("\n");
}
