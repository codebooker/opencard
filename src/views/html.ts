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
export const ASSET_VER = "20260720c";

// Older views place a visible <label> immediately before its control. Link
// those pairs centrally so every form surface (admin, auth, signup and /me)
// exposes the same accessible name a sighted user sees. Repeatable controls
// with more than one input per row provide their own aria-labels.
export const FORM_LABEL_SCRIPT = `<script>(function(){
  var n = 0;
  document.querySelectorAll('form label:not([for])').forEach(function(label){
    if (label.querySelector('input,select,textarea')) return;
    var node = label.nextElementSibling, control = null;
    while (node && !node.matches('label,h1,h2,h3,h4,hr')) {
      if (node.matches('input:not([type="hidden"]),select,textarea')) { control = node; break; }
      var nested = node.querySelectorAll('input:not([type="hidden"]),select,textarea');
      if (nested.length === 1) { control = nested[0]; break; }
      if (nested.length > 1) break;
      node = node.nextElementSibling;
    }
    if (!control) return;
    if (!control.id) control.id = 'oc-field-' + (++n);
    label.htmlFor = control.id;
  });
})();</script>`;

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
<footer class="oc-source-footer"><a href="${esc(config.sourceUrl)}" rel="noopener noreferrer">OpenCard source code</a> · AGPL-3.0</footer>
${FORM_LABEL_SCRIPT}
${opts.noUserway ? "" : userwayScript()}
</body>
</html>`;
}
