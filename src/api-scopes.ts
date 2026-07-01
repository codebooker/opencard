// API key permission scopes — pure, unit-testable, no runtime deps.
//
// Convention: "<resource>:<action>". A key with an EMPTY scope list is treated
// as full access, which keeps pre-existing keys (and the admin token) working.

export const API_SCOPES = [
  "brands:read",
  "brands:write",
  "stores:read",
  "stores:write",
  "cards:read",
  "cards:write",
  "leads:read",
  "analytics:read",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABELS: Record<ApiScope, string> = {
  "brands:read": "Read brands",
  "brands:write": "Create/edit brands",
  "stores:read": "Read stores",
  "stores:write": "Create/edit stores",
  "cards:read": "Read cards",
  "cards:write": "Create/edit/delete cards",
  "leads:read": "Read leads",
  "analytics:read": "Read analytics",
};

export function isApiScope(s: unknown): s is ApiScope {
  return typeof s === "string" && (API_SCOPES as readonly string[]).includes(s);
}

// Coerce arbitrary input (form values, JSON) to a clean, de-duplicated scope list.
export function sanitizeScopes(input: unknown): ApiScope[] {
  const arr = Array.isArray(input) ? input : input == null ? [] : [input];
  const seen = new Set<string>();
  const out: ApiScope[] = [];
  for (const v of arr) {
    if (isApiScope(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// Whether a key with `granted` scopes may perform an action needing `required`.
// An empty/absent grant means "unrestricted" (full access).
export function hasScope(granted: readonly string[] | null | undefined, required: string): boolean {
  if (!granted || granted.length === 0) return true;
  return granted.includes(required);
}
