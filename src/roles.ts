// Pure role definitions and authorization-flag logic. Kept free of any runtime
// imports (no db) so it can be unit-tested directly.
//
//   platform_owner — the SaaS operator; spans ALL orgs (no org filter).
//   org_owner      — full control of their own org (incl. admins/integrations).
//   org_admin      — manage their org's brands/rooftops/cards.
//   brand_admin    — scoped to specific brands within their org.
//   location_admin — scoped to specific rooftops within their org.
// `super_admin` / `general_admin` are retained for backward compatibility:
// super_admin behaves as platform_owner, general_admin as org_admin.
export type Role =
  | "platform_owner"
  | "platform_admin"
  | "platform_staff"
  | "org_owner"
  | "org_admin"
  | "super_admin"
  | "general_admin"
  | "brand_admin"
  | "location_admin";

export const ROLE_LABELS: Record<Role, string> = {
  platform_owner: "OpenCard owner",
  platform_admin: "OpenCard admin",
  platform_staff: "OpenCard staff",
  org_owner: "Org owner",
  org_admin: "Org admin",
  super_admin: "OpenCard owner",
  general_admin: "Org admin",
  brand_admin: "Brand admin",
  location_admin: "Store admin",
};

// The three OpenCard-staff tiers (platform roles), most-privileged first.
export const PLATFORM_ROLES: Role[] = ["platform_owner", "platform_admin", "platform_staff"];
export function isPlatformRole(role: string): boolean {
  return (PLATFORM_ROLES as string[]).includes(role) || role === "super_admin";
}

export interface RoleFlags {
  platform: boolean; // cross-org: sees/manages every org (no org filter)
  global: boolean; // all brands/stores within their scope
  super: boolean; // destructive actions, integrations, and admin management
  staffAdmin: boolean; // may manage OpenCard staff accounts
}

// A platform (OpenCard) admin who hasn't drilled into a client sees the clients
// CONSOLE; everyone else (clients, or platform admins managing a client) sees the
// normal management dashboard.
export function isConsole(p: { platform: boolean; actingOrgId: string | null }): boolean {
  return p.platform && !p.actingOrgId;
}

// Billing/plan UI is a client concern: shown to clients, and to platform admins
// only while managing a specific client — never on the OpenCard clients console.
export function showsBilling(p: { platform: boolean; actingOrgId: string | null }): boolean {
  return !p.platform || !!p.actingOrgId;
}

export function roleFlags(role: Role): RoleFlags {
  const platform = isPlatformRole(role);
  const global = platform || role === "org_owner" || role === "org_admin" || role === "general_admin";
  const superFlag = platform || role === "org_owner";
  // Owner and admin (and legacy super_admin) manage staff; plain staff cannot.
  const staffAdmin = role === "platform_owner" || role === "platform_admin" || role === "super_admin";
  return { platform, global, super: superFlag, staffAdmin };
}

// Which staff roles an actor may assign/create. Owners can grant any tier;
// admins can grant admin/staff but not owner; everyone else: none.
export function assignableStaffRoles(actorRole: string): Role[] {
  if (actorRole === "platform_owner" || actorRole === "super_admin") return [...PLATFORM_ROLES];
  if (actorRole === "platform_admin") return ["platform_admin", "platform_staff"];
  return [];
}

// May `actor` manage the staff account `target`? Must be a staff-admin, and only
// an owner may act on another owner (admins cannot modify/delete owners).
export function canManageStaffTarget(actorRole: string, targetRole: string): boolean {
  if (!roleFlags(actorRole as Role).staffAdmin) return false;
  const targetIsOwner = targetRole === "platform_owner" || targetRole === "super_admin";
  if (targetIsOwner && !(actorRole === "platform_owner" || actorRole === "super_admin")) return false;
  return true;
}
