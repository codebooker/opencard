import { LabeledValue, SocialLink } from "./types";

export const clean = (s: any): string | null => (s && String(s).trim() ? String(s).trim() : null);

// Allowed link schemes for user-supplied URLs (websites, socials). Anything else
// (javascript:, data:, vbscript:, ...) is rejected: these values end up in href
// attributes on public card pages and in vCards, where esc() protects the HTML
// but not the URL scheme.
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

// Returns a safe href for a user-supplied URL, or null when the value must not
// be rendered as a link. Scheme-less values ("example.com") are treated as
// https websites.
export function safeUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Browsers ignore control characters and whitespace inside a scheme
  // ("java\tscript:alert(1)"), so strip them before detecting the scheme.
  const probe = s.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  const scheme = probe.match(/^([a-z][a-z0-9+.-]*:)/)?.[1];
  if (scheme) return SAFE_SCHEMES.has(scheme) ? s : null;
  if (probe.startsWith("//")) return "https:" + s; // scheme-relative
  if (probe.startsWith("/")) return null; // path-relative — not a website
  return "https://" + s; // bare domain
}

// "Work | +1 555..." (one per line) -> [{label, value}]
export function parseLabeled(text: string): LabeledValue[] {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [label, ...rest] = l.split("|");
      const value = rest.join("|").trim();
      return value ? { label: label.trim() || "", value } : { label: "", value: label.trim() };
    })
    .filter((x) => x.value);
}

// "linkedin | https://..." (one per line) -> [{type, value}]
export function parseSocials(text: string): SocialLink[] {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [type, ...rest] = l.split("|");
      return { type: (type || "").trim().toLowerCase(), value: rest.join("|").trim() };
    })
    .filter((x) => x.value);
}

// Form address fields -> clean string map (no undefined keys) or null.
export function parseAddress(b: any): Record<string, string> | null {
  const out: Record<string, string> = {};
  const put = (k: string, v: any) => {
    if (v && String(v).trim()) out[k] = String(v).trim();
  };
  put("line1", b.addr_line1);
  put("city", b.addr_city);
  put("region", b.addr_region);
  put("postal", b.addr_postal);
  put("country", b.addr_country);
  return Object.keys(out).length ? out : null;
}
