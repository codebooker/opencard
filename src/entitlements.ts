// Compatibility helpers for creation paths. Self-hosted OpenCard has no
// subscriptions, feature tiers, or resource caps.
export type Feature =
  | "selfService" | "leadCapture" | "emailSignatures" | "csvExport"
  | "api" | "webhooks" | "sso" | "scim" | "customDomains"
  | "crmSync" | "advancedAnalytics" | "auditLogs";
export type LimitKey = "brands" | "locations" | "cards" | "admins" | "apiKeys" | "customDomains";

export async function orgHasFeature(_orgId: string, _feature: Feature): Promise<boolean> { return true; }

// All resources are uncapped in a self-hosted workspace.
export async function canAdd(_orgId: string, _key: LimitKey): Promise<boolean> { return true; }

export class OrgLimitReachedError extends Error {
  constructor(public readonly resource: LimitKey) {
    super(`The workspace has reached its ${resource} limit.`);
    this.name = "OrgLimitReachedError";
  }
}

export function isOrgLimitReached(error: unknown): error is OrgLimitReachedError {
  return error instanceof OrgLimitReachedError;
}

// Preserve the callback shape used by existing creation routes; it does not
// count resources, take a capacity lock, or reject card creation.
export async function withOrgLimit<T>(_orgId: string, _key: LimitKey, create: () => Promise<T>): Promise<T> { return create(); }
