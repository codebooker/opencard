import { prisma } from "./db";

// Tenant (Org) resolution.
//
// Phase 1 increment 1: the data model is now fully org-scoped (every tenant-owned
// row carries orgId). There is still a single org per deployment, so the "current
// org" is resolved here from that single org. Later increments resolve the org
// from the request (subdomain/custom domain, the admin's org, the API key's org,
// or a tenant-specific SCIM token) — callers should move to those as they land.

let cachedOrgId: string | null = null;

export async function defaultOrgId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  const org = await prisma.org.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!org) throw new Error("No org found — run the seed first.");
  cachedOrgId = org.id;
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
