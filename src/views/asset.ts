import { esc, page } from "./html";
import { rooftopCtas, parseOemBrands } from "../dealership";
import { resolveLeadFields, resolveConsentText, defaultLeadFieldsFor } from "../leadform";
import { renderLeadForm, leadRefScript, LeadAttribution } from "./leadform-view";

// A lightweight dealership landing page for a rooftop/department asset (no person).
export function renderAssetLanding(asset: any, baseUrl: string, attribution: LeadAttribution = {}, analyticsHead: string = ""): string {
  const loc = asset.location;
  const primary = loc.primaryColor || loc.brand?.primaryColor || "#1f6f43";
  const logo = loc.logoUrl || loc.brand?.logoUrl || null;
  const oems = parseOemBrands(loc.oemBrands);
  const ctas = rooftopCtas(loc);
  const addr = (loc.address as any) || {};
  const addrText = [addr.line1, addr.city, addr.region, addr.postal].filter(Boolean).join(", ");
  const leadFieldSet = new Set(resolveLeadFields(null, loc.brand?.leadFields, defaultLeadFieldsFor(asset.org?.vertical)));
  const consentText = resolveConsentText(null, loc.brand?.leadConsentText);

  const body = `
<main class="card" style="--primary:${esc(primary)};--text:#111827;--bg:#ffffff;--font:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <header class="hero">${logo ? `<img class="logo" src="${esc(logo)}" alt="logo" />` : ""}</header>
  <section class="ident">
    <h1>${esc(loc.name)}</h1>
    ${asset.name ? `<p class="title">${esc(asset.name)}</p>` : ""}
  </section>
  ${
    oems.length
      ? `<div class="dealer" style="border:0;padding-top:6px"><div class="oem-badges">${oems
          .map((o) => `<span class="oem">${esc(o)}</span>`)
          .join("")}</div></div>`
      : ""
  }
  ${
    addrText
      ? `<section class="contacts"><a class="row" href="https://maps.google.com/?q=${encodeURIComponent(
          addrText
        )}"><span class="row-ic">📍</span><span class="row-main"><span class="row-val">${esc(
          addrText
        )}</span><span class="row-lbl">Address</span></span></a></section>`
      : ""
  }
  ${
    ctas.length
      ? `<div class="dealer-ctas" style="margin:14px 24px">${ctas
          .map(
            (c) =>
              `<a class="cta dealer-cta cta-${c.kind}" href="${esc(c.href)}"${
                c.kind === "call" ? "" : ' target="_blank" rel="noopener"'
              }>${esc(c.label)}</a>`
          )
          .join("")}</div>`
      : ""
  }
  <button class="connect-toggle" onclick="document.getElementById('connect').classList.toggle('open')">Get in touch</button>
  <section id="connect" class="connect">
    ${renderLeadForm({
      action: `${esc(baseUrl)}/a/${esc(asset.slug)}/connect`,
      fields: leadFieldSet,
      consentText,
      attribution,
    })}
  </section>
  ${loc.hideCardFooter ? "" : `<footer class="brand">${esc(loc.brand?.name || "")} · ${esc(loc.name)}</footer>`}
</main>
${leadRefScript}`;
  return page({ title: `${loc.name} — ${asset.name}`, body, bodyClass: "card-body", head: analyticsHead });
}
