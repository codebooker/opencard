import { Request } from "express";
import { prisma } from "./db";
import { config } from "./config";
import { verifyEmail } from "./selfauth";

export type Role = "super_admin" | "general_admin" | "brand_admin" | "location_admin";

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super admin",
  general_admin: "General admin",
  brand_admin: "Brand admin",
  location_admin: "Store admin",
};

export interface AdminPrincipal {
  email: string | null;
  name: string;
  role: Role;
  global: boolean; // super or general — all brands/stores
  super: boolean;
  brandIds: string[]; // brand_admin scope
  locationIds: string[]; // location_admin scope
}

// Resolve the current admin from the request, or null if not an admin.
export async function getAdmin(req: Request): Promise<AdminPrincipal | null> {
  const cookies = (req as any).cookies || {};

  // 1) Break-glass super admin via ADMIN_TOKEN (cookie or bearer).
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer === config.adminToken || cookies.oc_admin === config.adminToken) {
    return {
      email: null,
      name: "Super admin (token)",
      role: "super_admin",
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
  return {
    email: au.email,
    name: au.name || au.email,
    role,
    global: role === "super_admin" || role === "general_admin",
    super: role === "super_admin",
    brandIds: au.scopes.map((s) => s.brandId).filter((x): x is string => !!x),
    locationIds: au.scopes.map((s) => s.locationId).filter((x): x is string => !!x),
  };
}

// ---- coarse permissions ----
export const canCreateBrand = (p: AdminPrincipal) => p.global;
export const canDeleteBrand = (p: AdminPrincipal) => p.super;
export const canManageIntegrations = (p: AdminPrincipal) => p.super;
export const canManageAdmins = (p: AdminPrincipal) => p.super;

// ---- scope resolution ----
export async function accessibleBrandIds(p: AdminPrincipal): Promise<string[]> {
  if (p.global) return (await prisma.brand.findMany({ select: { id: true } })).map((b) => b.id);
  const set = new Set(p.brandIds);
  if (p.locationIds.length) {
    const locs = await prisma.location.findMany({
      where: { id: { in: p.locationIds } },
      select: { brandId: true },
    });
    locs.forEach((l) => set.add(l.brandId));
  }
  return [...set];
}

export async function accessibleLocationIds(p: AdminPrincipal): Promise<string[]> {
  if (p.global) return (await prisma.location.findMany({ select: { id: true } })).map((l) => l.id);
  const set = new Set(p.locationIds);
  if (p.brandIds.length) {
    const locs = await prisma.location.findMany({
      where: { brandId: { in: p.brandIds } },
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
  if (p.global || p.brandIds.includes(brandId)) return true;
  if (p.locationIds.length) {
    return (await prisma.location.count({ where: { id: { in: p.locationIds }, brandId } })) > 0;
  }
  return false;
}

export async function canAccessLocation(p: AdminPrincipal, locationId: string): Promise<boolean> {
  if (p.global || p.locationIds.includes(locationId)) return true;
  if (p.brandIds.length) {
    return (await prisma.location.count({ where: { id: locationId, brandId: { in: p.brandIds } } })) > 0;
  }
  return false;
}

export async function canAccessCard(p: AdminPrincipal, cardId: string): Promise<boolean> {
  if (p.global) return true;
  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { locationId: true } });
  return card ? canAccessLocation(p, card.locationId) : false;
}
