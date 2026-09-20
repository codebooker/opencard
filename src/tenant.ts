import { prisma } from "./db";

// Tenant (Org) resolution.
//
// Org IDs remain in the data model for ownership and database row-level
// security, but a self-hosted installation has exactly one workspace.

let cachedOrgId: string | null = null;

export async function defaultOrgId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  const orgs = await prisma.org.findMany({ take: 2, select: { id: true } });
  if (orgs.length !== 1) throw new Error(`Expected exactly one workspace; found ${orgs.length}. Run the seed for a new installation, or migrate multi-company data before starting.`);
  cachedOrgId = orgs[0].id;
  return cachedOrgId;
}

// Org id that owns a given brand / location / card (authoritative source for writes).
export async function orgIdForBrand(brandId: string): Promise<string> {
  const b = await prisma.brand.findUnique({ where: { id: brandId }, select: { orgId: true } });
  if (!b) throw new Error("Brand not found");
  return b.orgId;
}

export async function orgIdForLocation(locationId: string): Promise<string> {
  const l = await prisma.location.findUnique({ where: { id: locationId }, select: { orgId: true } });
  if (!l) throw new Error("Location not found");
  return l.orgId;
}
