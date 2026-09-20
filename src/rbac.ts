import { Request } from "express";
import { prisma } from "./db";
import { config } from "./config";
import { verifyEmployeeIdentity } from "./selfauth";
import { findSession, SESSION_COOKIE } from "./account";
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
  staffAdmin: boolean; // may manage OpenCard staff accounts
  brandIds: string[]; // brand_admin scope
  locationIds: string[]; // location_admin scope
  // Legacy compatibility; always null in single-workspace deployments.
  actingOrgId: string | null;
}

const adminByEmail = (email: string) =>
  prisma.adminUser.findUnique({ where: { email }, include: { scopes: true } });

// Resolve the current admin from the request, or null if not an admin.
export async function getAdmin(req: Request): Promise<AdminPrincipal | null> {
  const cookies = (req as any).cookies || {};
  let p: AdminPrincipal | null = null;

  {
    // Admin identity comes only from real, revocable, per-user accounts:
    // (1) DB-backed session (password/MFA sign-ins) — preferred.
    // (2) Signed email cookie (SSO sign-ins via /me; stateless) — fallback.
    // The old ADMIN_TOKEN "break-glass" god-credential was removed: a single
    // static token granting platform-owner was a standing single point of
    // failure. Recovery/bootstrap now happens on the box via
    // `node dist/scripts/make-admin.js` (requires shell access).
    let au: (Awaited<ReturnType<typeof adminByEmail>>) | null = null;
    const sess = await findSession(cookies[SESSION_COOKIE]);
    if (sess) {
      au = await prisma.adminUser.findUnique({ where: { id: sess.adminUserId }, include: { scopes: true } });
    } else {
      const identity = verifyEmployeeIdentity(cookies.oc_emp);
      if (!identity) return null;
      au = await adminByEmail(identity.email);
      if (au) {
        const flags = roleFlags(au.role as Role);
        if (!flags.platform && au.orgId !== identity.orgId) return null;
      }
    }
    if (!au || !au.active) return null;
    const role = au.role as Role;
    const f = roleFlags(role);
    p = {
      email: au.email,
      name: au.name || au.email,
      role,
      // Platform admins have no home org; operate against the default org by default.
      orgId: au.orgId ?? (await defaultOrgId()),
      platform: f.platform,
      global: f.global,
      super: f.super,
      staffAdmin: f.staffAdmin,
      brandIds: au.scopes.map((s) => s.brandId).filter((x): x is string => !!x),
      locationIds: au.scopes.map((s) => s.locationId).filter((x): x is string => !!x),
      actingOrgId: null,
    };
  }

  return p;
}

// True only for a platform admin on the clients console (not drilled into a
// client). Use this — not `p.platform` — to decide "show/act across ALL orgs":
// once acting inside a client, a platform admin must be confined to that org.
export const seesAllOrgs = (_p: AdminPrincipal) => false;

// ---- coarse permissions ----
export const canCreateBrand = (p: AdminPrincipal) => p.global;
export const canDeleteBrand = (p: AdminPrincipal) => p.super;
export const canManageIntegrations = (p: AdminPrincipal) => p.super;
export const canManageAdmins = (p: AdminPrincipal) => p.super;

// ---- scope resolution (always confined to the admin's org unless platform) ----
export async function accessibleBrandIds(p: AdminPrincipal): Promise<string[]> {
  if (p.platform && !p.actingOrgId) return (await prisma.brand.findMany({ select: { id: true } })).map((b) => b.id);
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
  if (p.platform && !p.actingOrgId) return (await prisma.location.findMany({ select: { id: true } })).map((l) => l.id);
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

// Role-only check: brand_admin (scoped) and above may edit brands; NOT store admins.
// NOTE: this does NOT verify the brand belongs to the admin's org — use
// `canManageBrandScoped` in routes so an admin can't touch another tenant's brand.
export function canManageBrand(p: AdminPrincipal, brandId: string): boolean {
  return p.global || (p.role === "brand_admin" && p.brandIds.includes(brandId));
}

// Route guard: the admin has the brand-management role AND the brand lives in the
// org they're operating in (or they're the platform console seeing all orgs).
// This is the check every brand-mutating route must use for tenant isolation.
export async function canManageBrandScoped(p: AdminPrincipal, brandId: string): Promise<boolean> {
  return canManageBrand(p, brandId) && (await canAccessBrand(p, brandId));
}

export async function canAccessBrand(p: AdminPrincipal, brandId: string): Promise<boolean> {
  if (p.platform && !p.actingOrgId) return true;
  if (p.global) return (await prisma.brand.count({ where: { id: brandId, orgId: p.orgId } })) > 0;
  if (p.brandIds.includes(brandId)) return true;
  if (p.locationIds.length) {
    return (await prisma.location.count({ where: { id: { in: p.locationIds }, brandId, orgId: p.orgId } })) > 0;
  }
  return false;
}

export async function canAccessLocation(p: AdminPrincipal, locationId: string): Promise<boolean> {
  if (p.platform && !p.actingOrgId) return true;
  if (p.global) return (await prisma.location.count({ where: { id: locationId, orgId: p.orgId } })) > 0;
  if (p.locationIds.includes(locationId)) return true;
  if (p.brandIds.length) {
    return (await prisma.location.count({ where: { id: locationId, brandId: { in: p.brandIds }, orgId: p.orgId } })) > 0;
  }
  return false;
}

export async function canAccessCard(p: AdminPrincipal, cardId: string): Promise<boolean> {
  if (p.platform && !p.actingOrgId) return true;
  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { locationId: true, orgId: true } });
  if (!card || card.orgId !== p.orgId) return false;
  if (p.global) return true;
  return canAccessLocation(p, card.locationId);
}
