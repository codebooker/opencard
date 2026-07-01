import { httpUrl } from "./dealership";

// Pure turnover/offboarding helpers — no db/config, unit-testable in isolation.

// Build the redirect URL for an offboarded card from an admin choice:
//   "none"        -> no redirect (card 404s)
//   "rooftop"     -> the rooftop website
//   "card:<slug>" -> another card's public URL (e.g. the manager's)
export function redirectTargetUrl(
  choice: string,
  opts: { cardBaseUrl: string; rooftopWebsite?: string | null }
): string | null {
  if (!choice || choice === "none") return null;
  if (choice === "rooftop") return httpUrl(opts.rooftopWebsite ?? null);
  if (choice.startsWith("card:")) {
    const slug = choice.slice(5).trim();
    if (!slug) return null;
    const base = (opts.cardBaseUrl || "").replace(/\/+$/, "");
    return `${base}/c/${slug}`;
  }
  return null;
}

// The card update that offboards an employee: disable the public card, revoke
// self-service access (clear the owner email so their SSO no longer matches),
// and set the redirect target. Analytics + leads are left untouched (preserved).
export function offboardCardUpdate(redirectUrl: string | null) {
  return { active: false, ownerEmail: null, redirectUrl };
}

// The cloneable settings for a replacement card: the ROLE, DESIGN, and PLACEMENT,
// but nothing about the departing person (name, photo, bio, contacts, socials,
// pronouns, owner email). The caller supplies the new person's identity.
export function replacementCardData(source: any) {
  return {
    locationId: source.locationId,
    templateId: source.templateId ?? null,
    departmentId: source.departmentId ?? null,
    department: source.department ?? null,
    title: source.title ?? null,
    company: source.company ?? null,
    layout: source.layout ?? null,
    primaryColor: source.primaryColor ?? null,
    logoUrl: source.logoUrl ?? null,
    showQr: source.showQr ?? null,
    selfEditFields: source.selfEditFields ?? null,
  };
}
