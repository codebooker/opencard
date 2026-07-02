// Pure marketing helpers — no db/express. GA4 / GTM snippet building (with strict
// ID validation so nothing arbitrary is injected into the page <head>) and
// campaign short-link redirect URL construction. Unit-tested.

const GA_ID = /^G-[A-Z0-9]{4,20}$/i;
const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/i;

export function isGaId(v: string | null | undefined): boolean {
  return !!v && GA_ID.test(v.trim());
}
export function isGtmId(v: string | null | undefined): boolean {
  return !!v && GTM_ID.test(v.trim());
}

// Build the <head> analytics snippet for the given IDs (only valid IDs are used;
// invalid/blank ones are ignored). Returns "" when nothing is configured.
export function analyticsSnippet(gaId?: string | null, gtmId?: string | null): string {
  let out = "";
  if (isGtmId(gtmId)) {
    const id = gtmId!.trim();
    out += `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`;
  }
  if (isGaId(gaId)) {
    const id = gaId!.trim();
    out += `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>` +
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`;
  }
  return out;
}

// Normalize a campaign short-link code: lowercase, keep url-safe chars.
export function normalizeCampaignCode(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Build the redirect target for a campaign short link: append the campaign's UTM
// params to the landing URL without clobbering params already present on it.
export function campaignRedirectUrl(
  landingUrl: string,
  utm: { source?: string | null; medium?: string | null; campaign?: string | null; codeFallback?: string | null }
): string {
  let url: URL;
  try {
    url = new URL(landingUrl);
  } catch {
    return landingUrl; // not absolute — hand back as-is
  }
  const setIfAbsent = (key: string, val: string | null | undefined) => {
    if (val && !url.searchParams.has(key)) url.searchParams.set(key, val);
  };
  setIfAbsent("utm_source", utm.source || null);
  setIfAbsent("utm_medium", utm.medium || null);
  setIfAbsent("utm_campaign", utm.campaign || utm.codeFallback || null);
  return url.toString();
}
