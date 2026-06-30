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
  | "org_owner"
  | "org_admin"
  | "super_admin"
  | "general_admin"
  | "brand_admin"
  | "location_admin";

export const ROLE_LABELS: Record<Role, string> = {
  platform_owner: "Platform owner",
  org_owner: "Org owner",
  org_admin: "Org admin",
  super_admin: "Super admin",
  general_admin: "Org admin",
  brand_admin: "Brand admin",
  location_admin: "Store admin",
};

export interface RoleFlags {
  platform: boolean; // cross-org: sees/manages every org (no org filter)
  global: boolean; // all brands/stores within their scope
  super: boolean; // destructive actions, integrations, and admin management
}

export function roleFlags(role: Role): RoleFlags {
  const platform = role === "platform_owner" || role === "super_admin";
  const global = platform || role === "org_owner" || role === "org_admin" || role === "general_admin";
  const superFlag = platform || role === "org_owner";
  return { platform, global, super: superFlag };
}
