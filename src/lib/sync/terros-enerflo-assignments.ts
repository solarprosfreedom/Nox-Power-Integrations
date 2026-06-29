/**
 * Terros ↔ Enerflo assignment mapping (both directions):
 *
 *   Terros Owner / Setter  ↔  Enerflo Setter (setter_user_id / setter_email)
 *   Terros Closer          ↔  Enerflo Lead Owner / Sales Rep (agent_user_id / assign_to_email)
 */

export function pickTerrosOwnerEmailFromEnerflo(
  setterEmail: string | null | undefined,
  leadOwnerEmail: string | null | undefined,
): string {
  return (setterEmail?.trim() || leadOwnerEmail?.trim() || "");
}

export function pickTerrosCloserEmailFromEnerflo(
  setterEmail: string | null | undefined,
  leadOwnerEmail: string | null | undefined,
): string | null {
  const ownerSource = pickTerrosOwnerEmailFromEnerflo(setterEmail, leadOwnerEmail);
  const leadOwner = leadOwnerEmail?.trim() || "";
  return leadOwner && leadOwner !== ownerSource ? leadOwner : null;
}

export function pickEnerfloSetterEmailFromTerros(
  terrosOwnerEmail: string | null | undefined,
): string | undefined {
  const email = terrosOwnerEmail?.trim();
  return email || undefined;
}

export function pickEnerfloLeadOwnerEmailFromTerros(
  terrosCloserEmail: string | null | undefined,
): string | undefined {
  const email = terrosCloserEmail?.trim();
  return email || undefined;
}
