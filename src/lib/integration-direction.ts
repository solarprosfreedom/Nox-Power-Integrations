export type IntegrationSystem = "enerflo" | "sequifi" | "terros";

/**
 * Production integration policy.
 *
 * Enerflo and Terros are intentionally isolated. Neither system may create or
 * update records in the other.
 */
export function isIntegrationDirectionAllowed(
  source: IntegrationSystem,
  target: IntegrationSystem,
): boolean {
  const isEnerfloTerrosPair =
    (source === "enerflo" && target === "terros") ||
    (source === "terros" && target === "enerflo");
  return !isEnerfloTerrosPair;
}
