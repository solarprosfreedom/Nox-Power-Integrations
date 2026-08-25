export type EiecLookup = {
  eligible: boolean;
  match: string | null;
};

export async function lookupEiecEligibility(address: string): Promise<EiecLookup> {
  const geo = await fetch(
    "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?" +
      new URLSearchParams({
        f: "json",
        singleLine: address,
        countryCode: "USA",
        maxLocations: "1",
      }),
  ).then((r) => r.json()) as {
    candidates?: Array<{ address?: string; location?: { x: number; y: number } }>;
  };
  const cand = geo.candidates?.[0];
  if (!cand?.location) return { eligible: false, match: null };

  const query = await fetch(
    "https://services5.arcgis.com/0JZBOQZwAJvlvClt/arcgis/rest/services/R3_23_24_EJ_23_Union_Dissolve/FeatureServer/0/query?" +
      new URLSearchParams({
        f: "json",
        geometry: `${cand.location.x},${cand.location.y}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "*",
        returnGeometry: "false",
      }),
  ).then((r) => r.json()) as { features?: unknown[] };

  return {
    eligible: Array.isArray(query.features) && query.features.length > 0,
    match: cand.address ?? address,
  };
}
