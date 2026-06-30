import { Request } from "express";
import { prisma } from "./db";
import { config } from "./config";
import { verifyEmail } from "./selfauth";
import { defaultOrgId } from "./tenant";
import { Role, ROLE_LABELS, roleFlags } from "./roles";

// Re-exported so existing `from "./rbac"` / `from "../rbac"` imports keep working.
export { ROLE_LABELS, roleFlags };
export type { Role };

export interface AdminPrincipal {
  email: string | null;
  name: string;
  role: Role;
  orgId: string; // the org this admin operates within (default org for platform owners)
  platform: boolean; // cross-org: sees/manages every org (no org filter)
  global: boolean; // all brands/stores within their scope (platform or org owner/admin)
  super: boolean; // destructive actions, integrations, and admin management
  brandIds: string[]; // brand_admin scope
  locationIds: string[]; // location_admin scope
}

// Resolve the current admin from the request, or null if not an admin.
export async function getAdmin(req: Request): Promise<AdminPrincipal | null> {
  const cookies = (req as any).cookies || {};

  // 1) Break-glass platform owner via ADMIN_TOKEN (cookie or bearer).
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer === config.adminToken || cookies.oc_admin === config.adminToken) {
    return {
      email: null,
      name: "Platform owner (token)",
      role: "platform_owner",
      orgId: await defaultOrgId(),
      platform: true,
      global: true,
      super: true,
      brandIds: [],
      locationIds: [],
    };
  }

  // 2) SSO / password session (signed email cookie) mapped to an AdminUser.
  const email = verifyEmail(cookies.oc_emp);
  if (!email) return null;
  const au = await prisma.adminUser.findUnique({ where: { email }, include: { scopes: true } });
  if (!au || !au.active) return null;

  const role = au.role as Role;
  const f = roleFlags(role);
  return {
    email: au.email,
    name: au.name || au.email,
    role,
    // Platform admins have no home org; operate against the default org by default.
    orgId: au.orgId ?? (await defaultOrgId()),
    platform: f.platform,
    global: f.global,
    super: f.super,
    brandIds: au.scopes.map((s) => s.brandId).filter((x): x is string => !!x),
    locationIds: au.scopes.map((s) => s.locationId).filter((x): x is string => !!x),
  };
}

// ---- coarse permissions ----
export const canCreateBrand = (p: AdminPrincipal) => p.global;
export const canDeleteBrand = (p: AdminPrincipal) => p.super;
export const canManageIntegrations = (p: AdminPrincipal) => p.super;
export const canManageAdmins = (p: AdminPrincipal) => p.super;

// ---- scope resolution (always confined to the admin's org unless platform) ----
export async function accessibleBrandIds(p: AdminPrincipal): Promise<string[]> {
  if (p.platform) return (await prisma.brand.findMany({ select: { id: true } })).map((b) => b.id);
  if (p.global)
    return (await prisma.brand.findMany({ where: { orgId: p.orgId }, select: { id: true } })).map((b) => b.id);
  const set = new Set<string>();
  if (p.brandIds.length) {
    const bs = await prisma.brand.findMany({ where: { id: { in: p.brandIds }, orgId: p.orgId }, select: { id: true } });
    bs.forEach((b) => set.add(b.id));
  }
  if (p.locationIds.length) {
    const locs = await prisma.location.findMany({
      where: { id: { in: p.locationIds }, orgId: p.orgId },
      select: { brandId: true },
    });
    locs.forEach((l) => set.add(l.brandId));
  }
  return [...set];
}

export async function accessibleLocationIds(p: AdminPrincipal): Promise<string[]> {
  if (p.platform) return (await prisma.location.findMany({ select: { id: true } })).map((l) => l.id);
  if (p.global)
    return (await prisma.location.findMany({ where: { orgId: p.orgId }, select: { id: true } })).map((l) => l.id);
  const set = new Set<string>();
  if (p.locationIds.length) {
    const ls = await prisma.location.findMany({
      where: { id: { in: p.locationIds }, orgId: p.orgId },
      select: { id: true },
    });
    ls.forEach((l) => set.add(l.id));
  }
  if (p.brandIds.length) {
    const locs = await prisma.location.findMany({
      where: { brandId: { in: p.brandIds }, orgId: p.orgId },
      select: { id: true },
    });
    locs.forEach((l) => set.add(l.id));
  }
  return [...set];
}

// Edit brand settings + manage templates: brand_admin (scoped) and above; NOT store admins.
export function canManageBrand(p: AdminPrincipal, brandId: string): boolean {
  return p.global || (p.role === "brand_admin" && p.brandIds.includes(brandId));
}

export async function canAccessBrand(p: AdminPrincipal, brandId: string): Promise<boolean> {
  if (p.platform) return true;
  if (p.global) return (await prisma.brand.count({ where: { id: brandId, orgId: p.orgId } })) > 0;
  if (p.brandIds.includes(brandId)) return true;
  if (p.locationIds.length) {
    return (await prisma.location.count({ where: { id: { in: p.locationIds }, brandId, orgId: p.orgId } })) > 0;
  }
  return false;
}

export async function canAccessLocation(p: AdminPrincipal, locationId: string): Promise<boolean> {
  if (p.platform) return true;
  if (p.global) return (await prisma.location.count({ where: { id: locationId, orgId: p.orgId } })) > 0;
  if (p.locationIds.includes(locationId)) return true;
  if (p.brandIds.length) {
    return (await prisma.location.count({ where: { id: locationId, brandId: { in: p.brandIds }, orgId: p.orgId } })) > 0;
  }
  return false;
}

export async function canAccessCard(p: AdminPrincipal, cardId: string): Promise<boolean> {
  if (p.platform) return true;
  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { locationId: true, orgId: true } });
  if (!card || card.orgId !== p.orgId) return false;
  if (p.global) return true;
  return canAccessLocation(p, card.locationId);
}
