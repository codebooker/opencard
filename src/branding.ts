// Pure login-branding helpers — no db. Given a brand and an optional rooftop
// override, produce the palette + logo used to brand a client's login page.

export type LoginBranding = {
  name: string;
  logoUrl: string | null;
  primary: string;
  textColor: string;
  bgColor: string;
};

// Normalize a Host header to a comparable hostname: lowercase, no port, no
// trailing dot. Returns "" for empty input.
export function normalizeHost(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

// Only allow a safe CSS color (hex) to be interpolated into an inline <style>.
export function safeColor(v: string | null | undefined, fallback = "#1F5BEA"): string {
  return v && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
}

// Inline <style> that recolors the login palette (`.auth`) to a client's brand
// color. Loaded after styles.css so it overrides the default OpenCard palette.
export function brandLoginStyle(b: LoginBranding): string {
  const p = safeColor(b.primary);
  return `<style>
    .auth .btn{background:${p};}
    .auth .btn:hover{filter:brightness(0.95);}
    .auth .btn.secondary{background:#fff;color:${p};border:1.5px solid ${p};}
    .auth .auth-foot a,.auth .auth-brand a{color:${p};}
    .auth .auth-form input:focus,.auth .auth-breakglass input:focus{border-color:${p};box-shadow:0 0 0 3px color-mix(in srgb, ${p} 20%, #fff);}
  </style>`;
}

type BrandLike = {
  name?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  textColor?: string | null;
  bgColor?: string | null;
};
type LocationLike = { name?: string | null; logoUrl?: string | null; primaryColor?: string | null };

// Build login branding from a brand, with an optional rooftop overriding the
// logo + accent color (each rooftop can carry its own look).
export function loginBranding(brand: BrandLike | null | undefined, location?: LocationLike | null): LoginBranding | null {
  if (!brand) return null;
  return {
    name: brand.name || "OpenCard",
    logoUrl: (location?.logoUrl || brand.logoUrl) ?? null,
    primary: safeColor(location?.primaryColor || brand.primaryColor),
    textColor: safeColor(brand.textColor, "#111827"),
    bgColor: safeColor(brand.bgColor, "#ffffff"),
  };
}
