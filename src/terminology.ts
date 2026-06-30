import { prisma } from "./db";

export type Terminology = {
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
  return { ...base, ...custom };
}

export async function currentTerminology(): Promise<Terminology> {
  const org = await prisma.org.findFirst({ select: { vertical: true, terminology: true } });
  return mergeTerminology(org?.vertical, org?.terminology);
}

export const lower = (s: string) => s.toLowerCase();
