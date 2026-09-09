export type IntegrationSystem = "enerflo" | "sequifi" | "terros";

/**
 * Production integration policy.
 *
 * Enerflo is intentionally excluded from cross-system automations.
 */
export function isIntegrationDirectionAllowed(
  source: IntegrationSystem,
  target: IntegrationSystem,
): boolean {
  return source !== "enerflo" && target !== "enerflo";
}
