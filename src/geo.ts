// Rough, privacy-friendly scan location from the client IP via the bundled
// offline GeoLite database (geoip-lite). City-level at best, country at worst,
// nothing at all for private/unknown ranges — callers store whatever we get.
// No third-party network calls, no permission prompts.

import geoip from "geoip-lite";

export interface GeoPoint {
  city: string | null;
  region: string | null; // subdivision code, e.g. "CA", "TX", "IDF"
  country: string | null; // ISO 3166-1 alpha-2
}

// Strip a port and normalize IPv6-mapped IPv4 ("::ffff:1.2.3.4").
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = String(raw).trim();
  if (!ip) return null;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];
  return ip;
}

const PRIVATE =
  /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:)/i;

export function geoFor(rawIp: string | null | undefined): GeoPoint | null {
  const ip = normalizeIp(rawIp);
  if (!ip || PRIVATE.test(ip)) return null;
  const hit = geoip.lookup(ip);
  if (!hit || !hit.country) return null;
  return {
    city: hit.city || null,
    region: hit.region || null,
    country: hit.country,
  };
}

// "Austin, TX, US" / "Paris, FR" / "US" — for display and grouping.
export function geoLabel(g: { city?: string | null; region?: string | null; country?: string | null } | null): string {
  if (!g) return "";
  return [g.city, g.region, g.country].filter(Boolean).join(", ");
}

// Fields ready to spread into a Prisma create for models carrying geo columns.
export function geoFields(rawIp: string | null | undefined): {
  geoCity: string | null;
  geoRegion: string | null;
  geoCountry: string | null;
} {
  const g = geoFor(rawIp);
  return { geoCity: g?.city ?? null, geoRegion: g?.region ?? null, geoCountry: g?.country ?? null };
}
