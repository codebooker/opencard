// Tiny HTML helpers — no template engine needed.

import { config } from "../config";

// UserWay accessibility widget for public-facing pages. Empty string when not
// configured (USERWAY_ACCOUNT=off), so pages render without any third-party
// script. CSP in middleware/hardening.ts allowlists cdn.userway.org to match.
export function userwayScript(): string {
  if (!config.userwayAccount) return "";
  return `<script src="https://cdn.userway.org/widget.js" data-account="${esc(config.userwayAccount)}"></script>`;
}

// Favicon link for OpenCard-branded (admin/auth) pages. Kept off public client
// card pages, which carry the dealership's own brand rather than OpenCard's.
export const OC_FAVICON = `<link rel="icon" type="image/svg+xml" href="/opencard-icon.svg" />`;

export function esc(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Bump when styles.css changes so browsers/CDN refetch instead of serving a
// stale cached copy (the stylesheet URL becomes a new cache key).
export const ASSET_VER = "20260706a";

export function page(opts: {
  title: string;
  body: string;
  head?: string;
  bodyClass?: string;
  // Public card/landing surfaces are phone-first and carry the client's brand,
  // not OpenCard's — the floating accessibility widget looks out of place there.
  noUserway?: boolean;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(opts.title)}</title>
<link rel="stylesheet" href="/styles.css?v=${ASSET_VER}" />
${opts.head || ""}
</head>
<body class="${opts.bodyClass || ""}">
${opts.body}
${opts.noUserway ? "" : userwayScript()}
</body>
</html>`;
}
