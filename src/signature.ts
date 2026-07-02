import { asLabeled, Address } from "./types";

// Pure email-signature generator — no db/config. Builds an email-client-safe
// (table + inline styles) HTML signature and a plain-text fallback from card data.

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
  banner: { text: string; href: string | null } | null;
  primary: string;
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

// Build the signature model from a loaded card + context (urls, resolved CTAs).
export function buildSignatureModel(
  card: any,
  ctx: { cardBaseUrl: string; ctas?: SignatureCta[]; banner?: { text: string; href: string | null } | null }
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
    disclaimer: card.template?.disclaimer ?? null,
    banner: ctx.banner ?? null,
    primary: card.primaryColor || loc.primaryColor || card.template?.primaryColor || brand.primaryColor || "#1f6f43",
  };
}

// Render an email-client-safe HTML signature (tables + inline styles only).
export function renderSignatureHtml(m: SignatureModel): string {
  const p = esc(m.primary);
  const line = (html: string) => `<div style="font:13px Arial,Helvetica,sans-serif;color:#333;line-height:1.5">${html}</div>`;
  const contact: string[] = [];
  if (m.phone) contact.push(`<a href="${esc(telHref(m.phone))}" style="color:#333;text-decoration:none">${esc(m.phone)}</a>`);
  if (m.email) contact.push(`<a href="mailto:${esc(m.email)}" style="color:${p};text-decoration:none">${esc(m.email)}</a>`);
  const ctaHtml = m.ctas.length
    ? `<div style="margin-top:6px">${m.ctas
        .map(
          (c) =>
            `<a href="${esc(c.href)}" style="display:inline-block;margin:2px 6px 2px 0;padding:5px 10px;background:${p};color:#fff;font:bold 12px Arial,Helvetica,sans-serif;text-decoration:none;border-radius:4px">${esc(
              c.label
            )}</a>`
        )
        .join("")}</div>`
    : "";
  const bannerHtml = m.banner
    ? `<tr><td colspan="2" style="padding:8px 0 0">${
        m.banner.href
          ? `<a href="${esc(m.banner.href)}" style="text-decoration:none">`
          : ""
      }<div style="background:${p};color:#fff;font:bold 12px Arial,Helvetica,sans-serif;padding:8px 12px;border-radius:4px">${esc(
        m.banner.text
      )}</div>${m.banner.href ? `</a>` : ""}</td></tr>`
    : "";

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
    ${contact.length ? line(contact.join(' <span style="color:#bbb">|</span> ')) : ""}
    ${m.address ? line(`<span style="color:#777">${esc(m.address)}</span>`) : ""}
    ${line(`<a href="${esc(m.cardUrl)}" style="color:${p};font-weight:bold;text-decoration:none">View my digital card</a>`)}
    ${ctaHtml}
  </td>
</tr>
${bannerHtml}
${
  m.disclaimer
    ? `<tr><td colspan="2" style="padding:8px 0 0"><div style="font:10px Arial,Helvetica,sans-serif;color:#999;line-height:1.4">${esc(
        m.disclaimer
      )}</div></td></tr>`
    : ""
}
</tbody></table>`;
}

// Plain-text fallback.
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
