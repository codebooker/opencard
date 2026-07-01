// Pure lead attribution / source-tracking helpers — no db/config, unit-testable.

export type QueryLike = Record<string, string | string[] | undefined>;

// First string value for a query key (Express query values may be arrays).
function pick(q: QueryLike, key: string): string | null {
  const v = q?.[key];
  const s = Array.isArray(v) ? v[0] : v;
  const t = (s ?? "").toString().trim();
  return t ? t : null;
}

function cap(s: string | null, n: number): string | null {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) : s;
}

export type Utm = {
  campaign: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

// Extract UTM + campaign from a query. `campaign` accepts ?campaign= or the short
// ?c= (handy for printed QR/NFC codes); it falls back to utm_campaign.
export function parseUtm(q: QueryLike): Utm {
  const utmCampaign = cap(pick(q, "utm_campaign"), 120);
  const campaign = cap(pick(q, "campaign") ?? pick(q, "c") ?? utmCampaign, 120);
  return {
    campaign,
    utmSource: cap(pick(q, "utm_source"), 120),
    utmMedium: cap(pick(q, "utm_medium"), 120),
    utmCampaign,
  };
}

// Classify a device from a user-agent string.
export function deviceFromUa(ua: string | null | undefined): string {
  const s = (ua || "").toLowerCase();
  if (!s) return "unknown";
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit/.test(s)) return "bot";
  if (/ipad|tablet|(android(?!.*mobile))|kindle|silk|playbook/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|blackberry|windows phone/.test(s)) return "mobile";
  return "desktop";
}

export const PREFERRED_CONTACTS: [string, string][] = [
  ["any", "Any"],
  ["email", "Email"],
  ["phone", "Phone call"],
  ["text", "Text message"],
];

export function normalizePreferredContact(v: string | null | undefined): string | null {
  const s = (v || "").toLowerCase().trim();
  return PREFERRED_CONTACTS.some(([k]) => k === s) && s !== "any" ? s : s === "any" ? "any" : null;
}

// Store the referrer only if it looks like a real URL; cap its length.
export function cleanReferrer(ref: string | null | undefined): string | null {
  const s = (ref || "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return cap(s, 300);
}
