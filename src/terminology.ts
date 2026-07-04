import { prisma } from "./db";
import { VERTICAL_PACKS, packFor } from "./verticals";

// Verticals derive from the pack registry (verticals.ts) — adding a pack
// there automatically extends the customer-facing "Business type" dropdown
// and everything below. Labels never say "vertical" in the UI.

export type Vertical = string;
export const VERTICALS: [string, string][] = VERTICAL_PACKS.map((p) => [p.key, p.label]);

export function isVertical(v: unknown): v is Vertical {
  return VERTICAL_PACKS.some((p) => p.key === v);
}
export function verticalLabel(v: string | null | undefined): string {
  return packFor(v).label;
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

export function terminologyForVertical(vertical?: string | null): Terminology {
  const p = packFor(vertical);
  return { vertical: p.key, ...p.terminology };
}

// Kept as named exports for the many existing call sites and tests.
export const GENERAL_TERMINOLOGY: Terminology = terminologyForVertical("general");
export const DEALERSHIP_TERMINOLOGY: Terminology = terminologyForVertical("dealership");

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
