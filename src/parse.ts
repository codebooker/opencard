import { LabeledValue, SocialLink } from "./types";

export const clean = (s: any): string | null => (s && String(s).trim() ? String(s).trim() : null);

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
