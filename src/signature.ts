import { asLabeled, Address } from "./types";

// Pure email-signature generator — no db/config. Builds email-client-safe
// (table + inline styles) HTML signatures in several themes, plus a plain-text
// fallback, from card data. Also holds the Phase 6.2 governance helpers:
// campaign-banner windowing, per-rooftop disclaimer resolution, element locks.

export type SignatureTheme = "classic" | "compact" | "modern" | "minimal";

// Selectable signature designs (key -> label), most classic first.
export const SIGNATURE_THEMES: [SignatureTheme, string][] = [
  ["classic", "Classic"],
  ["compact", "Compact"],
  ["modern", "Modern banner"],
  ["minimal", "Minimal text"],
];

export function normalizeTheme(v: unknown): SignatureTheme {
  return (SIGNATURE_THEMES.some(([k]) => k === v) ? (v as SignatureTheme) : "classic");
}

// Signature elements an admin can lock so employees can't strip them.
export const SIGNATURE_ELEMENTS: [string, string][] = [
  ["banner", "Campaign banner"],
  ["disclaimer", "Legal disclaimer"],
  ["ctas", "Call-to-action buttons"],
  ["logo", "Logo"],
];

export function asLockList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const valid = new Set(SIGNATURE_ELEMENTS.map(([k]) => k));
  return v.filter((x): x is string => typeof x === "string" && valid.has(x));
}

export function isSignatureLocked(locks: string[], key: string): boolean {
  return locks.includes(key);
}

export type SignatureCta = { label: string; href: string };
export type SignatureModel = {
  fullName: string;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  cardUrl: string;
  qrUrl: string;
  ctas: SignatureCta[];
  disclaimer: string | null;
  // qrUrl: auto-generated QR of the banner link, shown while a campaign is active.
  banner: { text: string; href: string | null; qrUrl: string | null } | null;
  primary: string;
  theme: SignatureTheme;
  locks: string[];
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function telHref(phone: string): string {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}

// ---- governance helpers ----

// Return the brand campaign banner if it has text and `now` is within its window
// (either bound may be null = open-ended). Otherwise null.
export function activeCampaignBanner(
  brand:
    | {
        signatureBannerText?: string | null;
        signatureBannerHref?: string | null;
        signatureBannerStart?: Date | string | null;
        signatureBannerEnd?: Date | string | null;
      }
    | null
    | undefined,
  now: Date = new Date()
): { text: string; href: string | null } | null {
  const text = brand?.signatureBannerText?.trim();
  if (!text) return null;
  const t = now.getTime();
  if (brand!.signatureBannerStart && t < new Date(brand!.signatureBannerStart).getTime()) return null;
  if (brand!.signatureBannerEnd && t > new Date(brand!.signatureBannerEnd).getTime()) return null;
  return { text, href: brand!.signatureBannerHref?.trim() || null };
}

// Per-rooftop disclaimer wins; otherwise fall back to the card template's.
export function resolveDisclaimer(
  locationDisclaimer: string | null | undefined,
  templateDisclaimer: string | null | undefined
): string | null {
  const loc = locationDisclaimer?.trim();
  if (loc) return loc;
  const tpl = templateDisclaimer?.trim();
  return tpl || null;
}

// Build the signature model from a loaded card (with location + brand + template)
// plus context (base url, resolved CTAs, and optional banner override for previews).
export function buildSignatureModel(
  card: any,
  ctx: {
    cardBaseUrl: string;
    ctas?: SignatureCta[];
    now?: Date;
    // When provided, use this banner instead of computing from the brand campaign
    // (pass `null` to force "no banner", e.g. a specific preview).
    banner?: { text: string; href: string | null } | null;
    theme?: SignatureTheme; // override (e.g. preview a specific theme)
  }
): SignatureModel {
  const phones = asLabeled(card.phones);
  const emails = asLabeled(card.emails);
  const loc = card.location || {};
  const brand = loc.brand || {};
  const addr = (card.address as Address | null) || (loc.address as Address | null) || null;
  const addressText = addr
    ? [addr.line1, addr.city, addr.region, addr.postal].filter(Boolean).join(", ")
    : null;
  const base = (ctx.cardBaseUrl || "").replace(/\/+$/, "");
  const cardUrl = `${base}/c/${card.slug}`;
  const locks = asLockList(loc.signatureLocks);
  const rawBanner =
    ctx.banner !== undefined ? ctx.banner : activeCampaignBanner(brand, ctx.now || new Date());
  // Auto-generate a campaign QR from the banner link (hosted, email-client-safe).
  const banner = rawBanner
    ? {
        text: rawBanner.text,
        href: rawBanner.href,
        qrUrl: rawBanner.href ? `${base}/qr.png?data=${encodeURIComponent(rawBanner.href)}` : null,
      }
    : null;
  return {
    fullName: [card.firstName, card.lastName].filter(Boolean).join(" "),
    title: card.title ?? null,
    company: card.company || brand.name || null,
    email: emails[0]?.value || card.ownerEmail || null,
    phone: phones[0]?.value || loc.phone || null,
    address: addressText,
    logoUrl: card.logoUrl || loc.logoUrl || brand.logoUrl || null,
    cardUrl,
    qrUrl: `${cardUrl}/qr.png`,
    ctas: ctx.ctas || [],
    disclaimer: resolveDisclaimer(loc.signatureDisclaimer, card.template?.disclaimer),
    banner,
    primary: card.primaryColor || loc.primaryColor || card.template?.primaryColor || brand.primaryColor || "#1f6f43",
    theme: normalizeTheme(ctx.theme ?? loc.signatureTheme),
    locks,
  };
}

// ---- shared render fragments ----

function ctaButtons(m: SignatureModel, p: string): string {
  if (!m.ctas.length) return "";
  return `<div style="margin-top:6px">${m.ctas
    .map(
      (c) =>
        `<a href="${esc(c.href)}" style="display:inline-block;margin:2px 6px 2px 0;padding:5px 10px;background:${p};color:#fff;font:bold 12px Arial,Helvetica,sans-serif;text-decoration:none;border-radius:4px">${esc(
          c.label
        )}</a>`
    )
    .join("")}</div>`;
}

function bannerRow(m: SignatureModel, p: string): string {
  if (!m.banner) return "";
  const b = m.banner;
  const open = b.href ? `<a href="${esc(b.href)}" style="text-decoration:none">` : "";
  const close = b.href ? `</a>` : "";
  const textCell = `${open}<div style="background:${p};color:#fff;font:bold 12px Arial,Helvetica,sans-serif;padding:8px 12px;border-radius:4px">${esc(
    b.text
  )}</div>${close}`;
  if (!b.qrUrl) return `<tr><td colspan="2" style="padding:8px 0 0">${textCell}</td></tr>`;
  const qr = `<img src="${esc(b.qrUrl)}" alt="Scan for this offer" width="76" height="76" style="display:block;border:0;width:76px;height:76px" />`;
  return `<tr><td colspan="2" style="padding:8px 0 0">
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tbody><tr>
      <td valign="middle">${textCell}</td>
      <td valign="middle" style="padding:0 0 0 10px">${qr}</td>
    </tr></tbody></table></td></tr>`;
}

function disclaimerRow(m: SignatureModel): string {
  if (!m.disclaimer) return "";
  return `<tr><td colspan="2" style="padding:8px 0 0"><div style="font:10px Arial,Helvetica,sans-serif;color:#999;line-height:1.4">${esc(
    m.disclaimer
  )}</div></td></tr>`;
}

function contactInline(m: SignatureModel, p: string): string {
  const parts: string[] = [];
  if (m.phone) parts.push(`<a href="${esc(telHref(m.phone))}" style="color:#333;text-decoration:none">${esc(m.phone)}</a>`);
  if (m.email) parts.push(`<a href="mailto:${esc(m.email)}" style="color:${p};text-decoration:none">${esc(m.email)}</a>`);
  return parts.join(' <span style="color:#bbb">|</span> ');
}

// ---- theme renderers ----

function renderClassic(m: SignatureModel): string {
  const p = esc(m.primary);
  const line = (html: string) => `<div style="font:13px Arial,Helvetica,sans-serif;color:#333;line-height:1.5">${html}</div>`;
  const contact = contactInline(m, p);
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tbody>
<tr>
  ${
    m.logoUrl
      ? `<td valign="top" style="padding:0 14px 0 0"><img src="${esc(m.logoUrl)}" alt="${esc(
          m.company || m.fullName
        )}" height="56" style="display:block;border:0;max-height:56px" /></td>`
      : ""
  }
  <td valign="top" style="border-left:3px solid ${p};padding:0 0 0 14px">
    ${line(`<span style="font-weight:bold;font-size:15px;color:#111">${esc(m.fullName)}</span>`)}
    ${m.title || m.company ? line(`<span style="color:${p}">${esc([m.title, m.company].filter(Boolean).join(", "))}</span>`) : ""}
    ${contact ? line(contact) : ""}
    ${m.address ? line(`<span style="color:#777">${esc(m.address)}</span>`) : ""}
    ${line(`<a href="${esc(m.cardUrl)}" style="color:${p};font-weight:bold;text-decoration:none">View my digital card</a>`)}
    ${ctaButtons(m, p)}
  </td>
</tr>
${bannerRow(m, p)}
${disclaimerRow(m)}
</tbody></table>`;
}

function renderCompact(m: SignatureModel): string {
  const p = esc(m.primary);
  const nameLine = [
    `<span style="font-weight:bold;color:#111">${esc(m.fullName)}</span>`,
    m.title || m.company ? `<span style="color:${p}">${esc([m.title, m.company].filter(Boolean).join(", "))}</span>` : "",
  ]
    .filter(Boolean)
    .join(' <span style="color:#bbb">·</span> ');
  const contact = [contactInline(m, p), `<a href="${esc(m.cardUrl)}" style="color:${p};text-decoration:none">Digital card</a>`]
    .filter(Boolean)
    .join(' <span style="color:#bbb">|</span> ');
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tbody>
<tr><td style="font:13px Arial,Helvetica,sans-serif;color:#333;line-height:1.5">
  <div>${nameLine}</div>
  <div>${contact}</div>
  ${ctaButtons(m, p)}
</td></tr>
${bannerRow(m, p)}
${disclaimerRow(m)}
</tbody></table>`;
}

function renderModern(m: SignatureModel): string {
  const p = esc(m.primary);
  const line = (html: string) => `<div style="font:13px Arial,Helvetica,sans-serif;color:#333;line-height:1.5">${html}</div>`;
  const contact = contactInline(m, p);
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:460px"><tbody>
<tr><td colspan="2" style="background:${p};padding:12px 16px;border-radius:6px 6px 0 0">
  <span style="font:bold 16px Arial,Helvetica,sans-serif;color:#fff">${esc(m.fullName)}</span>
  ${m.title || m.company ? `<span style="font:13px Arial,Helvetica,sans-serif;color:#e8f0ff"> — ${esc([m.title, m.company].filter(Boolean).join(", "))}</span>` : ""}
</td></tr>
<tr>
  ${
    m.logoUrl
      ? `<td valign="top" style="padding:12px 14px;background:#f7f8fa"><img src="${esc(m.logoUrl)}" alt="${esc(
          m.company || m.fullName
        )}" height="48" style="display:block;border:0;max-height:48px" /></td>`
      : ""
  }
  <td valign="top" style="padding:12px 16px;background:#f7f8fa;border-radius:0 0 6px 6px">
    ${contact ? line(contact) : ""}
    ${m.address ? line(`<span style="color:#777">${esc(m.address)}</span>`) : ""}
    ${line(`<a href="${esc(m.cardUrl)}" style="color:${p};font-weight:bold;text-decoration:none">View my digital card</a>`)}
    ${ctaButtons(m, p)}
  </td>
</tr>
${bannerRow(m, p)}
${disclaimerRow(m)}
</tbody></table>`;
}

function renderMinimal(m: SignatureModel): string {
  const p = esc(m.primary);
  const line = (html: string) => `<div style="font:13px Arial,Helvetica,sans-serif;color:#333;line-height:1.5">${html}</div>`;
  const ctaText = m.ctas.length
    ? line(
        m.ctas
          .map((c) => `<a href="${esc(c.href)}" style="color:${p};text-decoration:none">${esc(c.label)}</a>`)
          .join(' <span style="color:#bbb">·</span> ')
      )
    : "";
  const bannerText = m.banner
    ? line(
        m.banner.href
          ? `<a href="${esc(m.banner.href)}" style="color:${p};font-weight:bold;text-decoration:none">${esc(m.banner.text)}</a>`
          : `<span style="font-weight:bold;color:${p}">${esc(m.banner.text)}</span>`
      ) +
      (m.banner.qrUrl
        ? `<div style="margin-top:4px"><img src="${esc(m.banner.qrUrl)}" alt="Scan for this offer" width="76" height="76" style="display:block;border:0;width:76px;height:76px" /></div>`
        : "")
    : "";
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tbody>
<tr><td style="font:13px Arial,Helvetica,sans-serif;color:#333;line-height:1.5">
  ${line(`<span style="font-weight:bold;color:#111">${esc(m.fullName)}</span>`)}
  ${m.title || m.company ? line(esc([m.title, m.company].filter(Boolean).join(", "))) : ""}
  ${contactInline(m, p) ? line(contactInline(m, p)) : ""}
  ${line(`<a href="${esc(m.cardUrl)}" style="color:${p};text-decoration:none">${esc(m.cardUrl)}</a>`)}
  ${ctaText}
  ${bannerText}
  ${m.disclaimer ? `<div style="font:10px Arial,Helvetica,sans-serif;color:#999;line-height:1.4;margin-top:6px">${esc(m.disclaimer)}</div>` : ""}
</td></tr>
</tbody></table>`;
}

// Render an email-client-safe HTML signature in the model's theme.
export function renderSignatureHtml(m: SignatureModel): string {
  switch (m.theme) {
    case "compact":
      return renderCompact(m);
    case "modern":
      return renderModern(m);
    case "minimal":
      return renderMinimal(m);
    case "classic":
    default:
      return renderClassic(m);
  }
}

// Plain-text fallback (theme-independent).
export function renderSignatureText(m: SignatureModel): string {
  const lines = [
    m.fullName,
    [m.title, m.company].filter(Boolean).join(", ") || null,
    m.phone,
    m.email,
    m.address,
    m.cardUrl,
    ...m.ctas.map((c) => `${c.label}: ${c.href}`),
    m.banner ? m.banner.text + (m.banner.href ? ` ${m.banner.href}` : "") : null,
    m.disclaimer ? `\n${m.disclaimer}` : null,
  ].filter((x): x is string => !!x);
  return lines.join("\n");
}
