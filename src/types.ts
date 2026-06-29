// Pure shared types + helpers for the JSON multi-value fields.
// Intentionally free of any @prisma/client runtime import so this module can be
// used (and unit-tested) without instantiating the database client.

// NOTE: these are `type` aliases, not `interface`, on purpose. TypeScript only
// considers object *type aliases* assignable to Prisma's `InputJsonValue`
// (which has an index signature); `interface`s are not, and would fail the build.
export type LabeledValue = {
  label: string;
  value: string;
};
export type SocialLink = {
  type: string; // linkedin | twitter | instagram | facebook | github | website ...
  value: string;
};
export type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal?: string;
  country?: string;
};

export function asLabeled(v: unknown): LabeledValue[] {
  return Array.isArray(v) ? (v as LabeledValue[]) : [];
}
export function asSocials(v: unknown): SocialLink[] {
  return Array.isArray(v) ? (v as SocialLink[]) : [];
}
