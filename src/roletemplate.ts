// Pure role-template helpers — no db/config, unit-testable in isolation.
// A role template layers behavior on top of a design template: which fields an
// employee may self-edit, which are hidden on the public card, QR behavior, and
// an email-signature block.

// Fields that a role template can hide from the PUBLIC card.
export const HIDEABLE_FIELDS: [string, string][] = [
  ["title", "Job title"],
  ["department", "Department"],
  ["company", "Company"],
  ["bio", "Bio"],
  ["pronouns", "Pronouns"],
  ["socials", "Social links"],
  ["address", "Address"],
];

// Tokens available in the email-signature template.
export const SIGNATURE_TOKENS = [
  "fullName", "firstName", "lastName", "title", "department", "company", "phone", "email", "cardUrl",
];

export const ROLE_SUGGESTIONS = [
  "Sales Consultant", "Sales Manager", "Service Advisor", "Parts Advisor",
  "Finance Manager", "BDC Representative", "General Manager",
];

// Coerce a JSON value to a string[] (defensive against bad data).
export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

// The self-editable fields for a card: the card override, else the brand policy,
// else the defaults — MINUS any fields the role template locks. Locked always
// wins, even over a card-level grant, so governance can't be bypassed.
export function effectiveSelfFields(
  cardSelf: string[] | null,
  brandSelf: string[] | null,
  locked: string[],
  defaults: string[]
): string[] {
  const base = cardSelf ?? brandSelf ?? defaults;
  const lockedSet = new Set(locked);
  return base.filter((f) => !lockedSet.has(f));
}

// Whether a public-card field is hidden by the role template.
export function isHidden(field: string, hidden: string[]): boolean {
  return hidden.includes(field);
}

// Resolve QR visibility down the chain: card override -> template -> brand -> true.
export function resolveShowQr(
  cardShowQr: boolean | null | undefined,
  templateShowQr: boolean | null | undefined,
  brandShowQr: boolean | null | undefined
): boolean {
  if (typeof cardShowQr === "boolean") return cardShowQr;
  if (typeof templateShowQr === "boolean") return templateShowQr;
  if (typeof brandShowQr === "boolean") return brandShowQr;
  return true;
}

// Render an email signature by substituting {{token}} placeholders. Unknown or
// missing tokens become empty strings. Returns "" when there's no template.
export function renderSignature(
  template: string | null | undefined,
  values: Record<string, string | null | undefined>
): string {
  if (!template) return "";
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = values[key];
    return v == null ? "" : String(v);
  });
}
