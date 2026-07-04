// Pure dealership helpers — no db/config, so they're unit-testable in isolation.
// Used to render a card's rooftop (dealership) context + call-to-action buttons.

export type CtaKind = "sales" | "service" | "site" | "call" | "custom";
export type Cta = { label: string; href: string; track: string; kind: CtaKind };

// The standard dealership department set (customizable per rooftop).
export const DEPARTMENTS = ["Sales", "Service", "Parts", "Finance", "BDC", "Management"] as const;

export type RooftopProfile = {
  phone?: string | null;
  website?: string | null;
  salesUrl?: string | null;
  serviceUrl?: string | null;
};

// Normalize a user-entered URL to an absolute http(s) URL, or null if it isn't a
// plausible web address (so junk like "tbd" doesn't render as a broken link).
export function httpUrl(raw: string | null | undefined): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  // bare domain like "acmeford.com" or "acmeford.com/sales"
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s) && /\.[a-z]{2,}(\/|$)/i.test(s)) return "https://" + s;
  return null;
}

// A tel: href from a human phone string. Keeps a leading + and digits only.
export function telHref(phone: string | null | undefined): string | null {
  const s = (phone || "").trim();
  if (!s) return null;
  const plus = s.startsWith("+") ? "+" : "";
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 7) return null; // not a real phone number
  return "tel:" + plus + digits;
}

// Default (dealership) button labels — callers that know the org's vertical
// pass packFor(vertical).ctaLabels instead, so a general business never
// shows "Call the dealership".
const DEFAULT_CTA_LABELS = {
  sales: "View inventory",
  service: "Schedule service",
  call: "Call the dealership",
  site: "Visit website",
};

// Ordered location CTAs for a card, derived from its profile. Invalid or
// empty entries are dropped, so the returned list is always render-ready.
export function rooftopCtas(r: RooftopProfile, labels: typeof DEFAULT_CTA_LABELS = DEFAULT_CTA_LABELS): Cta[] {
  const out: Cta[] = [];
  const sales = httpUrl(r.salesUrl);
  if (sales) out.push({ label: labels.sales, href: sales, track: "cta:sales", kind: "sales" });
  const service = httpUrl(r.serviceUrl);
  if (service) out.push({ label: labels.service, href: service, track: "cta:service", kind: "service" });
  const call = telHref(r.phone);
  if (call) out.push({ label: labels.call, href: call, track: "cta:call", kind: "call" });
  const site = httpUrl(r.website);
  if (site) out.push({ label: labels.site, href: site, track: "cta:site", kind: "site" });
  return out;
}

// Parse OEM franchises from a JSON array or a comma/newline-separated string;
// trim, drop blanks, de-dupe (case-insensitively), and cap the count.
export function parseOemBrands(v: unknown, max = 12): string[] {
  let arr: string[] = [];
  if (Array.isArray(v)) arr = v.map((x) => String(x));
  else if (typeof v === "string") arr = v.split(/[,\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const s = raw.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// Parse a department's stored CTAs ([{label,url}]) into validated, render-ready
// CTAs. Invalid URLs and blank labels are dropped; capped for sanity.
export function ctasFromJson(v: unknown, max = 8): Cta[] {
  if (!Array.isArray(v)) return [];
  const out: Cta[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const label = String((item as Record<string, unknown>).label ?? "").trim();
    const href = httpUrl(String((item as Record<string, unknown>).url ?? ""));
    if (!label || !href) continue;
    out.push({ label, href, track: "cta:custom", kind: "custom" });
    if (out.length >= max) break;
  }
  return out;
}

// Parse admin textarea input ("Label | https://url" per line) into raw CTA pairs
// for storage. Kept lossless (no URL normalization) so the editor round-trips.
export function parseCtaLines(text: string | null | undefined, max = 8): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  for (const line of (text || "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const idx = s.indexOf("|");
    if (idx < 0) continue;
    const label = s.slice(0, idx).trim();
    const url = s.slice(idx + 1).trim();
    if (label && url) out.push({ label, url });
    if (out.length >= max) break;
  }
  return out;
}

// Serialize stored CTA pairs back to editable "Label | url" lines.
export function ctaLinesFromJson(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v
    .filter((x) => x && typeof x === "object")
    .map((x) => `${(x as any).label ?? ""} | ${(x as any).url ?? ""}`)
    .join("\n");
}

// Merge department CTAs (primary) with rooftop CTAs (fallback), de-duped by href,
// department first. Capped so a card never shows an unwieldy wall of buttons.
export function mergeCtas(primary: Cta[], fallback: Cta[], max = 8): Cta[] {
  const seen = new Set(primary.map((c) => c.href));
  const out = [...primary];
  for (const c of fallback) {
    if (seen.has(c.href)) continue;
    seen.add(c.href);
    out.push(c);
  }
  return out.slice(0, max);
}

// Common North-American OEM names, for admin suggestions (not enforced).
export const KNOWN_OEMS = [
  "Ford", "Lincoln", "Chevrolet", "Buick", "GMC", "Cadillac", "Ram", "Jeep", "Dodge", "Chrysler",
  "Toyota", "Honda", "Nissan", "Hyundai", "Kia", "Genesis", "Subaru", "Mazda", "Mitsubishi",
  "Volkswagen", "Audi", "BMW", "Mercedes-Benz", "Volvo", "Lexus", "Acura", "Infiniti", "Tesla",
];

// IANA timezones commonly used by North-American dealerships, for the admin picker.
export const DEALERSHIP_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
  "America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver",
];
