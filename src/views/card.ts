import type { Card, Brand, Location, Template, Department } from "@prisma/client";
import { asLabeled, asSocials, Address } from "../types";
import { safeUrl } from "../parse";
import { esc, page } from "./html";
import { rooftopCtas, parseOemBrands, ctasFromJson, mergeCtas } from "../dealership";
import { asStringArray, isHidden, resolveShowQr, renderSignature } from "../roletemplate";
import { resolveLeadFields, resolveConsentText, defaultLeadFieldsFor } from "../leadform";
import { renderLeadForm, LeadAttribution } from "./leadform-view";

export type FullCard = Card & {
  location: Location & { brand: Brand };
  template: Template | null;
  dept?: Department | null;
};

export function fontStack(name?: string | null): string {
  switch ((name || "system").toLowerCase()) {
    case "serif":
      return "Georgia, 'Times New Roman', serif";
    case "mono":
      return "ui-monospace, Menlo, Consolas, monospace";
    case "rounded":
      return "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";
    case "grotesk":
      return "'Helvetica Neue', Arial, system-ui, sans-serif";
    default:
      return "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  }
}

// Design inheritance: card override -> location -> template -> brand.
function theme(card: FullCard) {
  const brand = card.location.brand;
  const primary =
    card.primaryColor ||
    card.location.primaryColor ||
    card.template?.primaryColor ||
    brand.primaryColor ||
    "#1f6f43";
  const layout =
    card.layout || card.location.layout || card.template?.layout || brand.layout || "classic";
  const text = card.template?.textColor || brand.textColor || "#111827";
  const bg = card.template?.bgColor || brand.bgColor || "#ffffff";
  const logo = card.logoUrl || card.location.logoUrl || brand.logoUrl || null;
  const font = fontStack(card.template?.font || brand.font);
  return { primary, layout, text, bg, logo, font };
}

const SOCIAL_ICONS: Record<string, string> = {
  linkedin: "in",
  twitter: "X",
  x: "X",
  instagram: "IG",
  facebook: "f",
  github: "GH",
  youtube: "YT",
  whatsapp: "WA",
  website: "🌐",
};

function contactRow(icon: string, label: string, value: string, href: string, dataAttr: string) {
  return `<a class="row" href="${esc(href)}" data-track="${esc(dataAttr)}">
    <span class="row-ic">${icon}</span>
    <span class="row-main"><span class="row-val">${esc(value)}</span><span class="row-lbl">${esc(label)}</span></span>
  </a>`;
}

export function renderCardPage(
  card: FullCard,
  qrDataUrl: string,
  baseUrl: string,
  attribution: LeadAttribution = {},
  analyticsHead: string = "",
  wallet: { apple: boolean; google: boolean } = { apple: false, google: false }
): string {
  const t = theme(card);
  // Role template: which fields to hide on the public card, QR behavior.
  const hidden = asStringArray((card.template as any)?.hiddenFields);
  const hide = (f: string) => isHidden(f, hidden);
  const showQr = resolveShowQr(card.showQr, (card.template as any)?.showQr, card.location.brand.showQr);
  const leadCapture = (card.template as any)?.leadCapture !== false;
  const brand = card.location.brand as any;
  const tpl = card.template as any;
  const leadFieldSet = new Set(
    resolveLeadFields(tpl?.leadFields, brand?.leadFields, defaultLeadFieldsFor((card as any).org?.vertical))
  );
  const consentText = resolveConsentText(tpl?.leadConsentText, brand?.leadConsentText);
  const fullName = [card.prefix, card.firstName, card.lastName].filter(Boolean).join(" ");
  const phones = asLabeled(card.phones);
  const emails = asLabeled(card.emails);
  const sites = asLabeled(card.websites);
  const socials = hide("socials") ? [] : asSocials(card.socials);
  const addr = hide("address")
    ? null
    : (card.address as Address | null) || (card.location.address as Address | null);

  const photo = card.photoUrl
    ? `<img class="photo" src="${esc(card.photoUrl)}" alt="${esc(fullName)}" />`
    : `<div class="photo photo-fallback">${esc((card.firstName[0] || "") + (card.lastName[0] || ""))}</div>`;

  const contacts: string[] = [];
  for (const p of phones)
    contacts.push(contactRow("📞", p.label || "Phone", p.value, `tel:${p.value}`, `click:phone`));
  for (const e of emails)
    contacts.push(contactRow("✉️", e.label || "Email", e.value, `mailto:${e.value}`, `click:email`));
  for (const w of sites) {
    // Whitelist the URL scheme: these values are cardholder-supplied and esc()
    // alone doesn't stop a javascript: href.
    const url = safeUrl(w.value);
    if (url) contacts.push(contactRow("🌐", w.label || "Website", w.value, url, `click:website`));
  }
  if (addr) {
    const addrText = [addr.line1, addr.city, addr.region, addr.postal, addr.country]
      .filter(Boolean)
      .join(", ");
    const maps = `https://maps.google.com/?q=${encodeURIComponent(addrText)}`;
    contacts.push(contactRow("📍", "Address", addrText, maps, `click:address`));
  }

  const socialLinks = socials
    .map((s) => ({ ...s, href: safeUrl(s.value) }))
    .filter((s): s is typeof s & { href: string } => !!s.href);
  const socialHtml = socialLinks.length
    ? `<div class="socials">${socialLinks
        .map(
          (s) =>
            `<a class="social" href="${esc(s.href)}" data-track="click:social:${esc(
              s.type
            )}" title="${esc(s.type)}">${esc(SOCIAL_ICONS[s.type.toLowerCase()] || s.type[0] || "•")}</a>`
        )
        .join("")}</div>`
    : "";

  // Dealership context: department CTAs (if any) take precedence over the
  // rooftop's; then OEM badges. Click-to-call + Sales/Service buttons.
  const rooftop = card.location as any;
  const deptCtas = ctasFromJson((card.dept as any)?.ctas);
  const roleCtas = ctasFromJson((card.template as any)?.roleCtas);
  // Order: department -> role -> rooftop, de-duped.
  const dealerCtas = mergeCtas(mergeCtas(deptCtas, roleCtas), rooftopCtas(rooftop));
  const oems = parseOemBrands(rooftop.oemBrands);
  const oemBadges = oems.length
    ? `<div class="oem-badges">${oems.map((o) => `<span class="oem">${esc(o)}</span>`).join("")}</div>`
    : "";
  const dealerSection = dealerCtas.length
    ? `<section class="dealer">
    <p class="dealer-name">${esc(card.location.name)}</p>
    ${oemBadges}
    <div class="dealer-ctas">${dealerCtas
      .map(
        (c) =>
          `<a class="cta dealer-cta cta-${c.kind}" href="${esc(c.href)}" data-track="${esc(c.track)}"${
            c.kind === "call" ? "" : ' target="_blank" rel="noopener"'
          }>${esc(c.label)}</a>`
      )
      .join("")}</div>
  </section>`
    : oemBadges
    ? `<section class="dealer"><p class="dealer-name">${esc(card.location.name)}</p>${oemBadges}</section>`
    : "";

  const body = `
<main class="card layout-${esc(t.layout)}" style="--primary:${esc(t.primary)};--text:${esc(
    t.text
  )};--bg:${esc(t.bg)};--font:${esc(t.font)}">
  ${
    t.layout === "wave"
      ? `<header class="hero-wave">
    ${
      card.photoUrl
        ? `<img class="hero-photo" src="${esc(card.photoUrl)}" alt="${esc(fullName)}" />`
        : `<div class="hero-photo hero-photo-empty"></div>`
    }
    <svg class="wave" viewBox="0 0 500 60" preserveAspectRatio="none" aria-hidden="true">
      <path class="wave-fill" d="M0,34 C150,64 350,4 500,16 L500,60 L0,60 Z"></path>
      <path class="wave-line" d="M0,34 C150,64 350,4 500,16" fill="none"></path>
    </svg>
  </header>`
      : `<header class="hero">
    ${t.logo ? `<img class="logo" src="${esc(t.logo)}" alt="logo" />` : ""}
    ${photo}
  </header>`
  }
  ${
    t.layout === "wave" && t.logo
      ? `<div class="wave-logo-wrap"><img src="${esc(t.logo)}" alt="logo" /></div>`
      : ""
  }
  <section class="ident">
    <h1>${esc(fullName)}</h1>
    ${card.pronouns && !hide("pronouns") ? `<p class="pronouns">(${esc(card.pronouns)})</p>` : ""}
    ${card.title && !hide("title") ? `<p class="title">${esc(card.title)}</p>` : ""}
    ${
      (() => {
        const parts = [hide("department") ? "" : card.department, hide("company") ? "" : card.company].filter(Boolean);
        return parts.length ? `<p class="company">${esc(parts.join(" · "))}</p>` : "";
      })()
    }
  </section>

  ${card.bio && !hide("bio") ? `<section class="bio"><p>${esc(card.bio)}</p></section>` : ""}

  ${contacts.length ? `<section class="contacts">${contacts.join("")}</section>` : ""}

  ${socialHtml}

  <a class="cta" href="${esc(baseUrl)}/c/${esc(card.slug)}/vcard" data-track="vcard">+ Add to Contacts</a>
  ${
    wallet.google
      ? `<a class="cta secondary" href="${esc(baseUrl)}/c/${esc(card.slug)}/wallet/google" data-track="wallet">Save to Google Wallet</a>`
      : ""
  }
  ${
    wallet.apple
      ? `<a class="cta secondary" href="${esc(baseUrl)}/c/${esc(card.slug)}/wallet/apple.pkpass" data-track="wallet">Add to Apple Wallet</a>`
      : ""
  }

  ${dealerSection}

  ${
    showQr
      ? `<section class="qr">
    <img src="${esc(qrDataUrl)}" alt="QR code" width="160" height="160" />
    <p>Scan to open this card</p>
  </section>`
      : ""
  }

  ${
    leadCapture
      ? `<button class="connect-toggle" onclick="document.getElementById('connect').classList.toggle('open')">
    Share your details back
  </button>
  <section id="connect" class="connect">
    ${renderLeadForm({
      action: `${esc(baseUrl)}/c/${esc(card.slug)}/connect`,
      fields: leadFieldSet,
      consentText,
      attribution,
    })}
  </section>`
      : ""
  }

  ${
    (card.template as any)?.disclaimer
      ? `<p class="disclaimer">${esc((card.template as any).disclaimer)}</p>`
      : ""
  }

  ${
    (card.location as any).hideCardFooter
      ? ""
      : `<footer class="brand">${esc(card.location.brand.name)} · ${esc(card.location.name)}</footer>`
  }
</main>

<script>
// Capture the referring page for lead attribution (all lead forms on the page).
try { document.querySelectorAll('.lead-ref').forEach(function(e){ e.value = document.referrer || ''; }); } catch (e) {}
// Lightweight click tracking — fire-and-forget beacon, never blocks navigation.
document.querySelectorAll('[data-track]').forEach(function (el) {
  el.addEventListener('click', function () {
    try {
      navigator.sendBeacon('${esc(baseUrl)}/c/${esc(card.slug)}/event',
        JSON.stringify({ type: el.getAttribute('data-track') }));
    } catch (e) {}
  });
});
</script>
`;
  return page({ title: fullName + " — " + card.location.brand.name, body, bodyClass: "card-body", head: analyticsHead });
}
