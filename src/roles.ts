// Pure role definitions and authorization-flag logic. Kept free of any runtime
// imports (no db) so it can be unit-tested directly.
//
//   platform_*    — legacy roles converted to org_owner by migration.
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

export function roleFlags(role: Role): RoleFlags {
  const legacyOwner = isPlatformRole(role);
  const global = legacyOwner || role === "org_owner" || role === "org_admin" || role === "general_admin";
  return { platform: false, global, super: legacyOwner || role === "org_owner", staffAdmin: false };
}
