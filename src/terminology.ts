import { prisma } from "./db";

// Supported verticals. Labels are customer-facing ("Business type") — never
// say "vertical" in the UI. Adding a vertical pack later = one entry here.
export type Vertical = "general" | "dealership";
export const VERTICALS: [Vertical, string][] = [
  ["general", "General business"],
  ["dealership", "Car dealership"],
];
export function isVertical(v: unknown): v is Vertical {
  return v === "general" || v === "dealership";
}
export function verticalLabel(v: string | null | undefined): string {
  return VERTICALS.find(([k]) => k === v)?.[1] || "General business";
}

export type Terminology = {
  vertical: Vertical;
  brandSingular: string;
  brandPlural: string;
  locationSingular: string;
  locationPlural: string;
  locationCodeLabel: string;
  cardSingular: string;
  cardPlural: string;
  leadSingular: string;
  leadPlural: string;
};

export const GENERAL_TERMINOLOGY: Terminology = {
  vertical: "general",
  brandSingular: "Brand",
  brandPlural: "Brands",
  locationSingular: "Location",
  locationPlural: "Locations",
  locationCodeLabel: "Location code",
  cardSingular: "Card",
  cardPlural: "Cards",
  leadSingular: "Lead",
  leadPlural: "Leads",
};

export const DEALERSHIP_TERMINOLOGY: Terminology = {
  vertical: "dealership",
  brandSingular: "Brand",
  brandPlural: "Brands",
  locationSingular: "Rooftop",
  locationPlural: "Rooftops",
  locationCodeLabel: "Rooftop code",
  cardSingular: "Card",
  cardPlural: "Cards",
  leadSingular: "Customer lead",
  leadPlural: "Customer leads",
};

export function terminologyForVertical(vertical?: string | null): Terminology {
  return vertical === "dealership" ? DEALERSHIP_TERMINOLOGY : GENERAL_TERMINOLOGY;
}

export function mergeTerminology(vertical: string | null | undefined, value: unknown): Terminology {
  const base = terminologyForVertical(vertical);
  const custom = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<Terminology>) : {};
  // Custom labels may override wording, never the vertical itself.
  return { ...base, ...custom, vertical: base.vertical };
}

// Terminology for the org the admin is operating in. (This used to findFirst()
// an arbitrary org, which leaked the first tenant's labels to everyone.)
export async function currentTerminology(orgId: string): Promise<Terminology> {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { vertical: true, terminology: true } });
  return mergeTerminology(org?.vertical, org?.terminology);
}

export const lower = (s: string) => s.toLowerCase();
