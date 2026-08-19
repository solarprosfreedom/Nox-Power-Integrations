export type IntegrationSystem = "enerflo" | "sequifi" | "terros";

/**
 * Production integration policy.
 *
 * Enerflo is the source of truth for the Enerflo/Terros pair. Terros-originated
 * activity must never create or update records in Enerflo.
 */
export function isIntegrationDirectionAllowed(
  source: IntegrationSystem,
  target: IntegrationSystem,
): boolean {
  return !(source === "terros" && target === "enerflo");
}
