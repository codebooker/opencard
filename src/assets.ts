import { httpUrl } from "./dealership";

// Pure dealership-asset helpers — no db/config, unit-testable in isolation.

// The asset-type catalog: value -> label.
export const ASSET_TYPES: [string, string][] = [
  ["rooftop", "Rooftop card"],
  ["department", "Department card"],
  ["desk", "Desk QR"],
  ["vehicle", "Vehicle window QR"],
  ["service_lane", "Service lane QR"],
  ["event", "Event QR"],
  ["campaign", "Campaign QR"],
];

// Where an asset sends a visitor.
export const ASSET_DEST_TYPES: [string, string][] = [
  ["landing", "Show a dealership landing page"],
  ["url", "Redirect to a URL"],
  ["card", "Redirect to a person's card"],
  ["sales", "Redirect to the rooftop Sales page"],
  ["service", "Redirect to the rooftop Service page"],
];

export function assetTypeLabel(type: string): string {
  return ASSET_TYPES.find(([v]) => v === type)?.[1] ?? type;
}

export type AssetDestination =
  | { kind: "redirect"; url: string }
  | { kind: "landing" }
  | { kind: "notfound" };

// Resolve what a scanned asset should do. The route resolves the destination
// card's slug (if any) and passes it in, keeping this function DB-free.
export function resolveAssetDestination(
  asset: { destinationType: string; destinationUrl?: string | null; destinationCardSlug?: string | null },
  rooftop: { salesUrl?: string | null; serviceUrl?: string | null; website?: string | null },
  opts: { cardBaseUrl: string }
): AssetDestination {
  const redirectOr404 = (raw: string | null | undefined): AssetDestination => {
    const u = httpUrl(raw ?? null);
    return u ? { kind: "redirect", url: u } : { kind: "notfound" };
  };
  switch (asset.destinationType) {
    case "landing":
      return { kind: "landing" };
    case "url":
      return redirectOr404(asset.destinationUrl);
    case "card": {
      const slug = (asset.destinationCardSlug ?? "").trim();
      if (!slug) return { kind: "notfound" };
      const base = (opts.cardBaseUrl || "").replace(/\/+$/, "");
      return { kind: "redirect", url: `${base}/c/${slug}` };
    }
    case "sales":
      return redirectOr404(rooftop.salesUrl);
    case "service":
      return redirectOr404(rooftop.serviceUrl);
    default:
      return { kind: "notfound" };
  }
}
