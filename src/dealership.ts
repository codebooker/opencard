// Pure dealership helpers — no db/config, so they're unit-testable in isolation.
// Used to render a card's rooftop (dealership) context + call-to-action buttons.

export type CtaKind = "sales" | "service" | "site" | "call";
export type Cta = { label: string; href: string; track: string; kind: CtaKind };

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

// Ordered dealership CTAs for a card, derived from its rooftop profile. Invalid
// or empty entries are dropped, so the returned list is always render-ready.
export function rooftopCtas(r: RooftopProfile): Cta[] {
  const out: Cta[] = [];
  const sales = httpUrl(r.salesUrl);
  if (sales) out.push({ label: "View inventory", href: sales, track: "cta:sales", kind: "sales" });
  const service = httpUrl(r.serviceUrl);
  if (service) out.push({ label: "Schedule service", href: service, track: "cta:service", kind: "service" });
  const call = telHref(r.phone);
  if (call) out.push({ label: "Call the dealership", href: call, track: "cta:call", kind: "call" });
  const site = httpUrl(r.website);
  if (site) out.push({ label: "Visit website", href: site, track: "cta:site", kind: "site" });
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
