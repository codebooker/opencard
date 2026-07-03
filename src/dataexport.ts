// Pure helpers for the GDPR/CCPA data export + erasure. No db here — the bundle
// assembly lives in data-bundle.ts. Unit-tested.

// A filesystem-safe export filename for an org + date.
export function exportFilename(orgName: string | null | undefined, date: Date = new Date()): string {
  const slug = String(orgName || "org")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";
  return `opencard-export-${slug}-${date.toISOString().slice(0, 10)}.json`;
}

// Return a shallow copy of `obj` with the given keys removed (strip secrets before
// exporting). Non-objects pass through unchanged.
export function stripKeys<T extends Record<string, any>>(obj: T | null | undefined, keys: string[]): Partial<T> {
  if (!obj || typeof obj !== "object") return {} as Partial<T>;
  const out: Record<string, any> = {};
  const drop = new Set(keys);
  for (const [k, v] of Object.entries(obj)) if (!drop.has(k)) out[k] = v;
  return out as Partial<T>;
}

// Strip secret keys from every row of a list.
export function stripRows<T extends Record<string, any>>(rows: T[] | null | undefined, keys: string[]): Partial<T>[] {
  return (rows || []).map((r) => stripKeys(r, keys));
}
