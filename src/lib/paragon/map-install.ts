export const PARAGON_EXCLUDED_STATUSES = new Set(["Cancelled", "Voided"]);

export const PARAGON_SHEET_HEADERS = [
  "Address",
  "External_id",
  "Customer_name",
  "Customer_phone",
  "Customer_email",
  "Customer_address",
  "Latitude",
  "Longitude",
] as const;

export interface ParagonInstallRow {
  installId: string;
  address: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  latitude: string;
  longitude: string;
  statusName: string;
}

export type ParagonMapResult =
  | { ok: true; row: ParagonInstallRow }
  | { ok: false; installId: string; statusName: string; skipReason: string };

export function isExcludedInstallStatus(statusName: string | null | undefined): boolean {
  return PARAGON_EXCLUDED_STATUSES.has(String(statusName ?? "").trim());
}

export function mapInstallToParagonRow(install: Record<string, unknown>): ParagonMapResult {
  const installId = String(install.id ?? install.installId ?? install.install_id ?? "").trim();
  const statusName = String(install.status_name ?? "").trim();

  if (!installId) {
    return { ok: false, installId: "", statusName, skipReason: "Missing install id" };
  }
  if (isExcludedInstallStatus(statusName)) {
    return { ok: false, installId, statusName, skipReason: `Excluded status: ${statusName}` };
  }

  const cust = (install.customer ?? {}) as Record<string, unknown>;
  const firstName = String(cust.first_name ?? cust.firstName ?? "").trim();
  const lastName = String(cust.last_name ?? cust.lastName ?? "").trim();
  const customerName =
    [firstName, lastName].filter(Boolean).join(" ") || String(cust.name ?? "").trim();
  const customerPhone = String(cust.phone ?? cust.mobile ?? "").trim();
  const customerEmail = String(cust.email ?? "").trim().toLowerCase();
  const addressLine1 = String(cust.address ?? cust.address_line1 ?? "").trim();
  const city = String(cust.city ?? "").trim();
  const state = String(cust.state ?? "").trim();
  const zip = String(cust.zip ?? "").trim();
  const customerAddress = [addressLine1, city, state, zip].filter(Boolean).join(", ");
  const address = customerAddress;

  const lat = cust.lat;
  const lng = cust.lng;
  const latitude = lat != null && lat !== "" ? String(lat) : "";
  const longitude = lng != null && lng !== "" ? String(lng) : "";

  return {
    ok: true,
    row: {
      installId,
      address,
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      latitude,
      longitude,
      statusName,
    },
  };
}

export function paragonRowToSheetValues(row: ParagonInstallRow): string[] {
  return [
    row.address,
    row.installId,
    row.customerName,
    row.customerPhone,
    row.customerEmail,
    row.customerAddress,
    row.latitude,
    row.longitude,
  ];
}
