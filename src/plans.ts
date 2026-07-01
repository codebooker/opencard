// Plans and entitlements — pure, no runtime deps, so it is unit-testable and can
// be imported anywhere (routes, views, tests) without pulling in the database.

export type PlanKey = "starter" | "team" | "dealer_group" | "enterprise";

// Feature flags gated by plan tier.
export type Feature =
  | "selfService" // employee self-service editing at /me
  | "leadCapture" // public "connect" lead forms
  | "emailSignatures"
  | "csvExport"
  | "api" // REST API access
  | "webhooks"
  | "sso" // SAML / OIDC admin+employee sign-in
  | "scim" // directory provisioning
  | "customDomains"
  | "crmSync"
  | "advancedAnalytics"
  | "auditLogs";

// Countable resource limits. -1 means unlimited.
export type LimitKey = "brands" | "locations" | "cards" | "admins" | "apiKeys" | "customDomains";

export interface Plan {
  key: PlanKey;
  label: string;
  // Human price string for display only; real prices live in Stripe.
  price: string;
  features: Feature[];
  limits: Record<LimitKey, number>;
}

const UNLIMITED = -1;

export const PLANS: Record<PlanKey, Plan> = {
  starter: {
    key: "starter",
    label: "Starter",
    price: "Free",
    features: ["leadCapture"],
    limits: { brands: 1, locations: 1, cards: 25, admins: 2, apiKeys: 0, customDomains: 0 },
  },
  team: {
    key: "team",
    label: "Team",
    price: "$49/mo",
    features: ["selfService", "leadCapture", "emailSignatures", "csvExport", "api"],
    limits: { brands: 3, locations: 10, cards: 250, admins: 10, apiKeys: 3, customDomains: 0 },
  },
  dealer_group: {
    key: "dealer_group",
    label: "Dealer Group",
    price: "$199/mo",
    features: [
      "selfService",
      "leadCapture",
      "emailSignatures",
      "csvExport",
      "api",
      "webhooks",
      "sso",
      "scim",
      "customDomains",
      "crmSync",
      "advancedAnalytics",
    ],
    limits: { brands: 25, locations: 100, cards: 5000, admins: 50, apiKeys: 20, customDomains: 5 },
  },
  enterprise: {
    key: "enterprise",
    label: "Enterprise",
    price: "Custom",
    features: [
      "selfService",
      "leadCapture",
      "emailSignatures",
      "csvExport",
      "api",
      "webhooks",
      "sso",
      "scim",
      "customDomains",
      "crmSync",
      "advancedAnalytics",
      "auditLogs",
    ],
    limits: {
      brands: UNLIMITED,
      locations: UNLIMITED,
      cards: UNLIMITED,
      admins: UNLIMITED,
      apiKeys: UNLIMITED,
      customDomains: UNLIMITED,
    },
  },
};

export const PLAN_ORDER: PlanKey[] = ["starter", "team", "dealer_group", "enterprise"];
export const DEFAULT_PLAN: PlanKey = "starter";

export function isPlanKey(key: string): key is PlanKey {
  return Object.prototype.hasOwnProperty.call(PLANS, key);
}

// Resolve a (possibly unknown) plan string to a Plan, falling back to the default.
export function planFor(key: string): Plan {
  return isPlanKey(key) ? PLANS[key] : PLANS[DEFAULT_PLAN];
}

export function hasFeature(planKey: string, feature: Feature): boolean {
  return planFor(planKey).features.includes(feature);
}

export function limitFor(planKey: string, key: LimitKey): number {
  return planFor(planKey).limits[key];
}

export function isUnlimited(limit: number): boolean {
  return limit < 0;
}

// True if a resource with `currentCount` existing rows may add one more.
export function withinLimit(planKey: string, key: LimitKey, currentCount: number): boolean {
  const limit = limitFor(planKey, key);
  return isUnlimited(limit) || currentCount < limit;
}

// The lowest plan that unlocks a feature (for upgrade prompts).
export function requiredPlanFor(feature: Feature): Plan | null {
  for (const key of PLAN_ORDER) {
    if (PLANS[key].features.includes(feature)) return PLANS[key];
  }
  return null;
}
