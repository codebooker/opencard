import { esc, page } from "./html";
import { Address } from "../types";
import { AdminPrincipal, ROLE_LABELS } from "../rbac";
import { showsBilling } from "../roles";
import { PLAN_ORDER } from "../plans";
import { API_SCOPES, SCOPE_LABELS } from "../api-scopes";
import { GENERAL_TERMINOLOGY, Terminology, lower } from "../terminology";
import {
  photoField,
  labeledRowsField,
  socialsField,
  editorScripts,
  designControls,
  designScripts,
  SELF_FIELDS,
  DEFAULT_SELF_FIELDS,
  PHONE_LABELS,
  EMAIL_LABELS,
  WEB_LABELS,
} from "./widgets";
import {
  KNOWN_OEMS,
  DEALERSHIP_TIMEZONES,
  parseOemBrands,
  DEPARTMENTS,
  ctaLinesFromJson,
} from "../dealership";
import { HIDEABLE_FIELDS, SIGNATURE_TOKENS, ROLE_SUGGESTIONS, asStringArray } from "../roletemplate";
import { ASSET_TYPES, ASSET_DEST_TYPES, assetTypeLabel } from "../assets";
import { LEAD_FIELDS, DEFAULT_LEAD_FIELDS } from "../leadform";
import { campaignRoutingToLines } from "../routing";
import { LEAD_STATUSES, STATUS_LABELS, nextStatuses } from "../leadstatus";

// Shared lead-form config block for the template + brand editors.
function leadFormConfig(opts: {
  fields: string[];
  consentText: string | null;
  inheritName: string;
  inheritLabel: string;
  inherit: boolean;
}): string {
  const set = new Set(opts.fields);
  const boxes = LEAD_FIELDS.map(
    ([v, l]) =>
      `<label class="chk"><input type="checkbox" name="leadFields" value="${esc(v)}" ${
        set.has(v) ? "checked" : ""
      } /> ${esc(l)}</label>`
  ).join("");
  return `
    <label class="chk" style="margin:8px 0"><input type="checkbox" name="${esc(opts.inheritName)}" value="1" ${
    opts.inherit ? "checked" : ""
  } /> ${esc(opts.inheritLabel)}</label>
    <label>Lead form fields <span class="muted">(name is always shown)</span></label>
    <div class="self-fields">${boxes}</div>
    <label style="margin-top:8px">Consent / privacy text</label>
    <textarea name="leadConsentText" rows="2" placeholder="I agree to be contacted about my inquiry.">${esc(
      opts.consentText || ""
    )}</textarea>`;
}

// Render the self-service "allowed fields" checkboxes.
function selfFieldChecks(allowed: string[], opts: { name: string; includeInherit?: boolean; inherit?: boolean } ): string {
  const set = new Set(allowed);
  const boxes = SELF_FIELDS.map(
    ([v, l]) =>
      `<label class="chk"><input type="checkbox" name="${opts.name}" value="${v}" ${
        set.has(v) ? "checked" : ""
      } /> ${esc(l)}</label>`
  ).join("");
  const inherit = opts.includeInherit
    ? `<label class="chk"><input type="checkbox" name="selfInherit" value="1" ${
        opts.inherit ? "checked" : ""
      } /> <strong>Inherit from brand</strong> (uncheck to set a custom policy for this card)</label>`
    : "";
  return `<div class="self-fields">${inherit}${boxes}</div>`;
}

function shell(title: string, body: string): string {
  return page({
    title,
    body: `<div class="admin">
      <div class="topbar">
        <h1><a href="/admin" style="text-decoration:none;color:#111827">OpenCard admin</a></h1>
        <div>
          <a class="btn secondary" href="/admin/analytics">Analytics</a>
          <a class="btn secondary" href="/admin/leads">Leads</a>
          <a class="btn secondary" href="/admin/logout">Sign out</a>
        </div>
      </div>
      ${body}
    </div>`,
  });
}

type LocationLite = { id: string; name: string; code: string | null; _count?: { cards: number } };
type BrandWithLocations = {
  id: string;
  name: string;
  primaryColor: string;
  logoUrl: string | null;
  locations: LocationLite[];
};

// The OpenCard staff console: every client workspace in the system. Platform
// staff see this instead of a client dashboard (no plan/billing of their own).
export function clientsConsole(orgs: any[], p: AdminPrincipal): string {
  const modePill = (m: string) =>
    `<span class="pill ${m === "demo" ? "off" : "on"}">${esc(m)}</span>`;
  const rows = orgs.length
    ? orgs
        .map(
          (o) => `<tr>
      <td><strong>${esc(o.name)}</strong>${
            o.subdomain ? `<br><span class="muted" style="font-size:11px">${esc(o.subdomain)}</span>` : ""
          }</td>
      <td>${esc(o.plan)}</td>
      <td>${modePill(o.billingMode)}</td>
      <td class="muted">${esc(o.subscriptionStatus)}</td>
      <td class="muted" style="font-size:12px">${o._count.brands} brands · ${o._count.cards} cards · ${o._count.leads} leads</td>
      <td style="white-space:nowrap"><a class="btn secondary" href="/admin/clients/${esc(o.id)}/settings">Edit</a>
      <form method="POST" action="/admin/clients/${esc(o.id)}/enter" style="display:inline"><button class="btn secondary" type="submit">Manage</button></form></td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="muted">No client workspaces yet.</td></tr>`;
  const body = `
  <p class="muted">Signed in as ${esc(p.name)} · <strong>OpenCard staff</strong></p>
  <div class="topbar"><h2>Clients</h2><div><a class="btn secondary" href="/admin/security">Security</a> <a class="btn" href="/admin/clients/new">+ New client</a></div></div>
  <p class="muted">Every workspace in the system. “Manage” administers a client's brands, cards, leads and SSO; “Edit” sets its plan and seat allowance.</p>
  <table>
    <tr><th>Client</th><th>Plan</th><th>Mode</th><th>Status</th><th>Usage</th><th></th></tr>
    ${rows}
  </table>`;
  return shell("Clients", body);
}

// Create/edit a client (OpenCard staff): name, plan tier, billing type, seats.
export function clientForm(org?: any): string {
  const o = org || {};
  const action = org ? `/admin/clients/${esc(o.id)}/settings` : "/admin/clients";
  const planOpts = PLAN_ORDER.map((k) => `<option value="${k}" ${o.plan === k ? "selected" : ""}>${k}</option>`).join("");
  const modeOpts = [
    ["free", "Free"],
    ["standard", "Paid"],
    ["demo", "Trial"],
  ]
    .map(([v, l]) => `<option value="${v}" ${o.billingMode === v ? "selected" : ""}>${l}</option>`)
    .join("");
  const seatVal = o.seatLimit == null ? "" : o.seatLimit < 0 ? "unlimited" : String(o.seatLimit);
  const body = `
  <h2>${org ? "Edit client" : "New client"}</h2>
  <form class="editor" method="POST" action="${action}" style="max-width:560px">
    <label>Client name</label><input name="name" value="${esc(o.name)}" required />
    <label style="margin-top:10px">Plan tier <span class="muted">(feature set)</span></label>
    <select name="plan">${planOpts}</select>
    <label style="margin-top:10px">Billing type</label>
    <select name="billingMode">${modeOpts}</select>
    <label style="margin-top:10px">User allowance <span class="muted">(blank = plan default · "unlimited" = per-seat billing · or a number)</span></label>
    <input name="seatLimit" value="${esc(seatVal)}" placeholder="e.g. 50, or unlimited" />
    <p style="margin-top:14px"><button class="btn" type="submit">${org ? "Save client" : "Create client"}</button>
    <a class="btn secondary" href="/admin/clients">Cancel</a></p>
  </form>`;
  return shell(org ? "Edit client" : "New client", body);
}

export function dashboard(
  brands: BrandWithLocations[],
  p: AdminPrincipal,
  t: Terminology = GENERAL_TERMINOLOGY,
  actingClientName?: string
): string {
  const canManage = (brandId: string) =>
    p.global || (p.role === "brand_admin" && p.brandIds.includes(brandId));
  const topActions = `
    ${showsBilling(p) ? `<a class="btn secondary" href="/admin/billing">Plan</a>` : ""}
    <a class="btn secondary" href="/admin/security">Security</a>
    ${p.super ? `<a class="btn secondary" href="/admin/admins">Admins</a>` : ""}
    ${p.super ? `<a class="btn secondary" href="/admin/integrations">Integrations</a>` : ""}
    ${p.global ? `<a class="btn" href="/admin/brands/new">+ New ${lower(t.brandSingular)}</a>` : ""}`;
  const banner = actingClientName
    ? `<div class="stat" style="border:1px solid #2563eb;background:#eff6ff;margin-bottom:12px">Managing client <strong>${esc(
        actingClientName
      )}</strong> · <a href="/admin/clients/exit">← back to all clients</a></div>`
    : "";
  const body = `
  ${banner}
  <p class="muted">Signed in as ${esc(p.name)} · <strong>${esc(ROLE_LABELS[p.role])}</strong></p>
  <div class="topbar"><h2>${esc(t.brandPlural)} &amp; ${esc(lower(t.locationPlural))}</h2><div>${topActions}</div></div>
  ${
    brands.length === 0
      ? `<p class="muted">No ${esc(lower(t.brandPlural))} in your scope yet.</p>`
      : brands
          .map(
            (b) => `
    <div class="stat" style="margin-bottom:16px">
      <div class="topbar">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${esc(
            b.primaryColor
          )}"></span>
          <strong>${esc(b.name)}</strong>
          ${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="" style="height:22px" />` : ""}
        </div>
        <div>
          ${
            canManage(b.id)
              ? `<a class="btn secondary" href="/admin/templates?brandId=${esc(b.id)}">Templates</a>
          <a class="btn secondary" href="/admin/brands/${esc(b.id)}/edit">Edit ${esc(lower(t.brandSingular))}</a>
          <a class="btn" href="/admin/locations/new?brandId=${esc(b.id)}">+ ${esc(t.locationSingular)}</a>`
              : ""
          }
        </div>
      </div>
      <table style="margin-top:10px">
        <tr><th>${esc(t.locationSingular)}</th><th>Code</th><th>${esc(t.cardPlural)}</th><th></th></tr>
        ${
          b.locations.length
            ? b.locations
                .map(
                  (l) => `<tr>
            <td>${esc(l.name)}</td>
            <td class="muted">${esc(l.code || "—")}</td>
            <td>${l._count?.cards ?? 0}</td>
            <td>
              <a href="/admin/cards?locationId=${esc(l.id)}">${esc(t.cardPlural)}</a> ·
              <a href="/admin/locations/${esc(l.id)}/edit">Edit</a>
            </td></tr>`
                )
                .join("")
            : `<tr><td colspan="4" class="muted">No ${esc(lower(t.locationPlural))} yet.</td></tr>`
        }
      </table>
    </div>`
          )
          .join("")
  }`;
  return shell("OpenCard admin", body);
}

const LAYOUTS = ["classic", "banner", "minimal", "wave"];

export function brandForm(
  brand?: any,
  stats?: { locations: number; cards: number },
  t: Terminology = GENERAL_TERMINOLOGY
): string {
  const b = brand || {};
  const action = brand ? `/admin/brands/${brand.id}` : "/admin/brands";
  const body = `
  <h2>${brand ? "Edit" : "New"} ${esc(lower(t.brandSingular))}</h2>
  <form class="editor" method="POST" action="${action}" enctype="multipart/form-data">
    <label>Brand name</label><input name="name" value="${esc(b.name)}" required />
    <label>Logo</label>
    ${b.logoUrl ? `<p class="muted">Current: <img src="${esc(b.logoUrl)}" style="height:34px;vertical-align:middle" /></p>` : ""}
    <input type="file" name="logoFile" accept="image/*" />
    <label>…or paste a logo URL</label><input name="logoUrl" value="${esc(b.logoUrl)}" placeholder="https://.../logo.png" />
    <h3>Design</h3>
    <p class="muted">Pick a layout, colors and font — the preview updates live. ${esc(t.cardPlural)} inherit this unless a ${esc(lower(t.locationSingular))}, template, or the ${esc(lower(t.cardSingular))} overrides it.</p>
    ${designControls({
      layout: b.layout,
      primaryColor: b.primaryColor,
      textColor: b.textColor,
      bgColor: b.bgColor,
      font: b.font,
    })}
    <label class="chk" style="margin-top:12px"><input type="checkbox" name="showQr" value="1" ${
      b.showQr === false ? "" : "checked"
    } /> Show the QR code on the card page</label>
    <p class="muted">The QR image stays available at <code>/c/&lt;slug&gt;/qr.png</code> for printing on physical NFC/PVC cards, even when hidden on the page.</p>

    <h3>Self-service editing</h3>
    <p class="muted">Which fields employees may edit on their own card (at <code>/me</code> via SSO). Per-card overrides are available on each card.</p>
    ${selfFieldChecks(Array.isArray(b.selfEditFields) ? b.selfEditFields : DEFAULT_SELF_FIELDS, {
      name: "selfEditFields",
    })}

    <h3 style="margin-top:16px">Lead form (default)</h3>
    <p class="muted">The default lead-capture form for this brand's cards and asset landing pages. Templates can override it.</p>
    ${leadFormConfig({
      fields: Array.isArray(b.leadFields) ? asStringArray(b.leadFields) : DEFAULT_LEAD_FIELDS,
      consentText: b.leadConsentText,
      inheritName: "leadDefault",
      inheritLabel: "Use the built-in default lead form",
      inherit: b.leadFields == null,
    })}

    <p style="margin-top:16px"><button class="btn" type="submit">Save brand</button>
    <a class="btn secondary" href="/admin">Cancel</a></p>
  </form>
  ${
    brand
      ? `<div class="danger-zone">
    <h3>Danger zone — delete brand</h3>
    <p class="muted">Permanently deletes <strong>${esc(b.name)}</strong> and everything under it:
    <strong>${stats?.locations ?? 0}</strong> ${esc(lower(t.locationPlural))} and <strong>${stats?.cards ?? 0}</strong> ${esc(lower(t.cardPlural))},
    including their analytics and captured leads. This cannot be undone.</p>
    <form method="POST" action="/admin/brands/${esc(b.id)}/delete" onsubmit="return confirmBrandDelete(this)">
      <label>To confirm, type the brand name exactly as shown: <strong>${esc(b.name)}</strong></label>
      <input name="confirmName" autocomplete="off" placeholder="${esc(b.name)}" />
      <button class="btn danger" type="submit">Delete this brand</button>
    </form>
  </div>
  <script>
  function confirmBrandDelete(f){
    var expected = ${JSON.stringify(b.name || "")};
    if (f.confirmName.value !== expected){ alert('The name you typed does not match exactly. Please type: ' + expected); return false; }
    if (!confirm('Are you ABSOLUTELY sure? This permanently deletes the ${lower(t.brandSingular)} "' + expected + '", all of its ${lower(t.locationPlural)}, and all of its ${lower(t.cardPlural)}. This cannot be undone.')) return false;
    if (!confirm('Final confirmation: this is irreversible. Delete ' + expected + ' now?')) return false;
    return true;
  }
  </script>`
      : ""
  }
  ${designScripts()}`;
  return shell("Brand", body);
}

export function locationForm(
  brandId: string,
  location?: any,
  t: Terminology = GENERAL_TERMINOLOGY
): string {
  const l = location || {};
  const addr = (l.address as Address) || {};
  const action = location ? `/admin/locations/${location.id}` : "/admin/locations";
  const body = `
  <h2>${location ? "Edit" : "New"} ${esc(lower(t.locationSingular))}</h2>
  <form class="editor" method="POST" action="${action}" enctype="multipart/form-data">
    <input type="hidden" name="brandId" value="${esc(brandId)}" />
    <label>${esc(t.locationSingular)} name</label><input name="name" value="${esc(l.name)}" required />
    <label>${esc(t.locationCodeLabel)} (for directory mapping)</label><input name="code" value="${esc(l.code)}" placeholder="e.g. STORE-014" />
    <p class="muted">Leave the overrides blank to inherit from the ${esc(lower(t.brandSingular))}.</p>
    <label>Logo override</label>
    ${l.logoUrl ? `<p class="muted">Current: <img src="${esc(l.logoUrl)}" style="height:34px;vertical-align:middle" /></p>` : ""}
    <input type="file" name="logoFile" accept="image/*" />
    <div class="grid2">
      <div><label>…or logo override URL</label><input name="logoUrl" value="${esc(l.logoUrl)}" /></div>
      <div><label>Primary color override</label><input name="primaryColor" value="${esc(l.primaryColor)}" /></div>
    </div>
    <label>Layout override</label>
    <select name="layout"><option value="">(inherit)</option>${LAYOUTS.map(
      (x) => `<option ${l.layout === x ? "selected" : ""}>${x}</option>`
    ).join("")}</select>
    <h3>${esc(t.locationSingular)} address (shown on ${esc(lower(t.cardPlural))} by default)</h3>
    <label>Address line 1</label><input name="addr_line1" value="${esc(addr.line1)}" />
    <div class="grid2">
      <div><label>City</label><input name="addr_city" value="${esc(addr.city)}" /></div>
      <div><label>Region/State</label><input name="addr_region" value="${esc(addr.region)}" /></div>
    </div>
    <div class="grid2">
      <div><label>Postal code</label><input name="addr_postal" value="${esc(addr.postal)}" /></div>
      <div><label>Country</label><input name="addr_country" value="${esc(addr.country)}" /></div>
    </div>

    <h3>Dealership profile</h3>
    <p class="muted">Shown on this ${esc(lower(t.locationSingular))}'s cards as click-to-call and Sales/Service buttons.</p>
    <label>OEM brands <span class="muted">(comma-separated)</span></label>
    <input name="oemBrands" list="oem-list" value="${esc(parseOemBrands(l.oemBrands).join(", "))}" placeholder="e.g. Ford, Lincoln" />
    <datalist id="oem-list">${KNOWN_OEMS.map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>
    <div class="grid2">
      <div><label>Main phone</label><input name="phone" value="${esc(l.phone)}" placeholder="(555) 123-4567" /></div>
      <div><label>Website</label><input name="website" value="${esc(l.website)}" placeholder="acmeford.com" /></div>
    </div>
    <div class="grid2">
      <div><label>Sales URL</label><input name="salesUrl" value="${esc(l.salesUrl)}" placeholder="acmeford.com/inventory" /></div>
      <div><label>Service URL</label><input name="serviceUrl" value="${esc(l.serviceUrl)}" placeholder="acmeford.com/service" /></div>
    </div>
    <label>Timezone</label>
    <select name="timezone"><option value="">(none)</option>${DEALERSHIP_TIMEZONES.map(
      (tz) => `<option ${l.timezone === tz ? "selected" : ""}>${esc(tz)}</option>`
    ).join("")}</select>

    <h3>Lead routing</h3>
    <p class="muted">Where leads from this ${esc(lower(t.locationSingular))} are emailed (in addition to the card owner).</p>
    <label>Rooftop lead inbox <span class="muted">(BDC / sales desk)</span></label>
    <input name="leadEmail" type="email" value="${esc(l.leadEmail)}" placeholder="leads@dealer.com" />
    <label style="margin-top:8px">Campaign routing <span class="muted">(one per line: <code>campaign | email</code>)</span></label>
    <textarea name="campaignRouting" rows="2" placeholder="summer | summer-team@dealer.com">${esc(
      campaignRoutingToLines(l.campaignRouting)
    )}</textarea>

    <p style="margin-top:16px"><button class="btn" type="submit">Save ${esc(lower(t.locationSingular))}</button>
    <a class="btn secondary" href="/admin">Cancel</a>
    ${location ? `<a class="btn secondary" href="/admin/locations/${esc(location.id)}/departments">Departments</a>` : ""}
    ${location ? `<a class="btn secondary" href="/admin/locations/${esc(location.id)}/assets">Assets</a>` : ""}</p>
  </form>`;
  return shell(t.locationSingular, body);
}

// Manage the departments (and their CTAs) within a rooftop.
export function departmentsView(data: { location: any; departments: any[] }): string {
  const loc = data.location;
  const existing = new Set(data.departments.map((d) => d.name));
  const suggestions = DEPARTMENTS.filter((d) => !existing.has(d));
  const rows = data.departments.length
    ? data.departments
        .map(
          (d) => `<form class="editor" method="POST" action="/admin/locations/${esc(loc.id)}/departments"
      style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:12px">
      <input type="hidden" name="departmentId" value="${esc(d.id)}" />
      <strong>${esc(d.name)}</strong>
      <label style="margin-top:8px">Call-to-action buttons <span class="muted">(one per line: <code>Label | https://url</code>)</span></label>
      <textarea name="ctas" rows="3" placeholder="Schedule service | acmeford.com/service">${esc(ctaLinesFromJson(d.ctas))}</textarea>
      <label style="margin-top:8px">Department lead inbox <span class="muted">(emailed on leads from this department's cards)</span></label>
      <input name="leadEmail" type="email" value="${esc(d.leadEmail)}" placeholder="service-leads@dealer.com" />
      <p style="margin-top:8px"><button class="btn" type="submit">Save</button>
      <button class="btn danger" type="submit" formaction="/admin/departments/${esc(d.id)}/delete"
        formnovalidate onclick="return confirm('Delete the ${esc(d.name)} department? Cards keep their other settings.')">Delete</button></p>
    </form>`
        )
        .join("")
    : `<p class="muted">No departments yet.</p>`;

  const body = `
  <h2>Departments — ${esc(loc.name)}</h2>
  <p class="muted">Each department can carry its own CTA buttons, which take precedence over the rooftop's on cards assigned to it.</p>
  ${rows}
  <h3 style="margin-top:20px">Add a department</h3>
  <form class="editor" method="POST" action="/admin/locations/${esc(loc.id)}/departments" style="max-width:560px">
    <label>Name</label>
    <input name="name" list="dept-suggest" placeholder="Sales" required />
    <datalist id="dept-suggest">${suggestions.map((d) => `<option value="${esc(d)}"></option>`).join("")}</datalist>
    <label style="margin-top:8px">Call-to-action buttons <span class="muted">(one per line: <code>Label | https://url</code>)</span></label>
    <textarea name="ctas" rows="3" placeholder="View inventory | acmeford.com/inventory"></textarea>
    <label style="margin-top:8px">Department lead inbox <span class="muted">(optional)</span></label>
    <input name="leadEmail" type="email" placeholder="service-leads@dealer.com" />
    <p style="margin-top:10px"><button class="btn" type="submit">Add department</button>
    <a class="btn secondary" href="/admin/locations/${esc(loc.id)}/edit">Back</a></p>
  </form>`;
  return shell("Departments", body);
}

// Manage dealership QR/NFC assets within a rooftop.
export function assetsView(data: { location: any; assets: any[]; cards: any[]; cardBaseUrl: string }): string {
  const loc = data.location;
  const base = (data.cardBaseUrl || "").replace(/\/+$/, "");
  const typeOpts = (sel: string) =>
    ASSET_TYPES.map(([v, l]) => `<option value="${esc(v)}" ${sel === v ? "selected" : ""}>${esc(l)}</option>`).join("");
  const destTypeOpts = (sel: string) =>
    ASSET_DEST_TYPES.map(([v, l]) => `<option value="${esc(v)}" ${sel === v ? "selected" : ""}>${esc(l)}</option>`).join("");
  const cardOpts = (sel: string) =>
    `<option value="">—</option>` +
    data.cards
      .map((c) => `<option value="${esc(c.id)}" ${sel === c.id ? "selected" : ""}>${esc([c.firstName, c.lastName].join(" "))}</option>`)
      .join("");

  const destFields = (a: any) => `
    <label style="margin-top:8px">Destination</label>
    <select name="destinationType">${destTypeOpts(a.destinationType || "landing")}</select>
    <div class="grid2" style="margin-top:6px">
      <div><label class="muted">URL <span class="muted">(for "Redirect to a URL")</span></label><input name="destinationUrl" value="${esc(
        a.destinationUrl
      )}" placeholder="acmeford.com/summer" /></div>
      <div><label class="muted">Card <span class="muted">(for "Redirect to a person's card")</span></label><select name="destinationCardId">${cardOpts(
        a.destinationCardId || ""
      )}</select></div>
    </div>`;

  const rows = data.assets.length
    ? data.assets
        .map((a) => {
          const url = `${base}/a/${a.slug}`;
          return `<form class="editor" method="POST" action="/admin/locations/${esc(loc.id)}/assets"
        style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:12px">
        <input type="hidden" name="assetId" value="${esc(a.id)}" />
        <div class="grid2">
          <div><label>Type</label><select name="type">${typeOpts(a.type)}</select></div>
          <div><label>Name</label><input name="name" value="${esc(a.name)}" required /></div>
        </div>
        ${destFields(a)}
        <p class="muted" style="margin-top:8px">Public: <a href="${esc(url)}" target="_blank">${esc(
          url
        )}</a> · <a href="${esc(url)}/qr.png" target="_blank">QR</a> · ${a.scanCount} scan${
            a.scanCount === 1 ? "" : "s"
          } · <span class="pill ${a.active ? "on" : "off"}">${a.active ? "active" : "off"}</span></p>
        <p style="margin-top:8px"><button class="btn" type="submit">Save</button>
        <button class="btn danger" type="submit" formaction="/admin/assets/${esc(
          a.id
        )}/delete" formnovalidate onclick="return confirm('Delete this asset?')">Delete</button></p>
      </form>`;
        })
        .join("")
    : `<p class="muted">No assets yet.</p>`;

  const body = `
  <h2>Assets — ${esc(loc.name)}</h2>
  <p class="muted">QR/NFC codes that aren't people: rooftop &amp; department landings, and trackable desk / vehicle / service-lane / event / campaign codes. Scans are counted.</p>
  ${rows}
  <h3 style="margin-top:20px">Add an asset</h3>
  <form class="editor" method="POST" action="/admin/locations/${esc(loc.id)}/assets" style="max-width:620px">
    <div class="grid2">
      <div><label>Type</label><select name="type">${typeOpts("campaign")}</select></div>
      <div><label>Name</label><input name="name" placeholder="e.g. Summer Sales Event" required /></div>
    </div>
    ${destFields({ destinationType: "landing", destinationUrl: "", destinationCardId: "" })}
    <p style="margin-top:10px"><button class="btn" type="submit">Add asset</button>
    <a class="btn secondary" href="/admin/locations/${esc(loc.id)}/edit">Back</a></p>
  </form>`;
  return shell("Assets", body);
}

export function cardList(
  locationName: string,
  locationId: string,
  cards: any[],
  t: Terminology = GENERAL_TERMINOLOGY
): string {
  const body = `
  <div class="topbar">
    <h2>${esc(t.cardPlural)} — ${esc(locationName)}</h2>
    <a class="btn" href="/admin/cards/new?locationId=${esc(locationId)}">+ New ${esc(lower(t.cardSingular))}</a>
  </div>
  <table>
    <tr><th>Name</th><th>Title</th><th>Public link</th><th>Status</th><th></th></tr>
    ${
      cards.length
        ? cards
            .map(
              (c) => `<tr>
      <td>${esc([c.prefix, c.firstName, c.lastName].filter(Boolean).join(" "))}</td>
      <td class="muted">${esc(c.title || "")}</td>
      <td><a href="/c/${esc(c.slug)}" target="_blank">/c/${esc(c.slug)}</a></td>
      <td><span class="pill ${c.active ? "on" : "off"}">${c.active ? "active" : "off"}</span></td>
      <td>
        <a href="/admin/cards/${esc(c.id)}/edit">Edit</a> ·
        <a href="/admin/cards/${esc(c.id)}/analytics">Stats</a> ·
        <a href="/c/${esc(c.slug)}/qr.png" target="_blank">QR</a>
      </td></tr>`
            )
            .join("")
        : `<tr><td colspan="5" class="muted">No ${esc(lower(t.cardPlural))} in this ${esc(lower(t.locationSingular))} yet.</td></tr>`
    }
  </table>
  <p style="margin-top:14px"><a class="btn secondary" href="/admin">← Back</a></p>`;
  return shell(t.cardPlural, body);
}

export function cardForm(opts: {
  card?: any;
  locationId: string;
  templates: any[];
  departments?: any[];
  brandSelfFields?: string[];
  terminology?: Terminology;
}): string {
  const t = opts.terminology || GENERAL_TERMINOLOGY;
  const c = opts.card || {};
  const cardOverride = Array.isArray(c.selfEditFields) ? (c.selfEditFields as string[]) : null;
  const inheritSelf = !cardOverride;
  const effectiveSelf = cardOverride || opts.brandSelfFields || DEFAULT_SELF_FIELDS;
  const action = opts.card ? `/admin/cards/${opts.card.id}` : "/admin/cards";
  const addr = (c.address as Address) || {};
  const body = `
  <h2>${opts.card ? "Edit" : "New"} ${esc(lower(t.cardSingular))}</h2>
  <form class="editor" method="POST" action="${action}" enctype="multipart/form-data">
    <input type="hidden" name="locationId" value="${esc(opts.locationId)}" />
    <div class="grid2">
      <div><label>Prefix</label><input name="prefix" value="${esc(c.prefix)}" placeholder="Mr./Dr." /></div>
      <div><label>Pronouns</label><input name="pronouns" value="${esc(c.pronouns)}" placeholder="he/him" /></div>
    </div>
    <div class="grid2">
      <div><label>First name *</label><input name="firstName" value="${esc(c.firstName)}" required /></div>
      <div><label>Last name *</label><input name="lastName" value="${esc(c.lastName)}" required /></div>
    </div>
    <div class="grid2">
      <div><label>Title</label><input name="title" value="${esc(c.title)}" /></div>
      <div><label>Department</label>${
        opts.departments && opts.departments.length
          ? `<select name="departmentId"><option value="">— none —</option>${opts.departments
              .map(
                (d) =>
                  `<option value="${esc(d.id)}" ${c.departmentId === d.id ? "selected" : ""}>${esc(d.name)}</option>`
              )
              .join("")}</select>`
          : `<input name="department" value="${esc(c.department)}" placeholder="e.g. Sales" />`
      }</div>
    </div>
    <label>Company (overrides brand name on card)</label><input name="company" value="${esc(c.company)}" />
    <label>Bio</label><textarea name="bio" rows="2">${esc(c.bio)}</textarea>

    ${photoField(c.photoUrl)}

    <h3>Contact</h3>
    ${labeledRowsField({ name: "phones", title: "Phones", placeholder: "+1 555 123 4567", options: PHONE_LABELS, items: c.phones })}
    ${labeledRowsField({ name: "emails", title: "Emails", placeholder: "you@company.com", options: EMAIL_LABELS, items: c.emails })}
    ${labeledRowsField({ name: "websites", title: "Websites", placeholder: "https://...", options: WEB_LABELS, items: c.websites })}
    ${socialsField(c.socials)}

    <h3>${esc(t.cardSingular)} address (blank = use ${esc(lower(t.locationSingular))} address)</h3>
    <label>Line 1</label><input name="addr_line1" value="${esc(addr.line1)}" />
    <div class="grid2">
      <div><label>City</label><input name="addr_city" value="${esc(addr.city)}" /></div>
      <div><label>Region</label><input name="addr_region" value="${esc(addr.region)}" /></div>
    </div>
    <div class="grid2">
      <div><label>Postal</label><input name="addr_postal" value="${esc(addr.postal)}" /></div>
      <div><label>Country</label><input name="addr_country" value="${esc(addr.country)}" /></div>
    </div>

    <h3>Design</h3>
    <p class="muted">Pick a template, or leave on the ${esc(lower(t.brandSingular))}/${esc(lower(t.locationSingular))} default. No hex codes needed.</p>
    <div class="tpl-pick">
      <label class="${!c.templateId ? "sel" : ""}">
        <input type="radio" name="templateId" value="" ${!c.templateId ? "checked" : ""} />
        <div class="tpl-mini" style="display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px;text-align:center">${esc(t.brandSingular)} /<br>${esc(lower(t.locationSingular))} default</div>
        <div class="tpl-cap">Inherit</div>
      </label>
      ${opts.templates
        .map(
          (t) => `<label class="${c.templateId === t.id ? "sel" : ""}">
        <input type="radio" name="templateId" value="${esc(t.id)}" ${c.templateId === t.id ? "checked" : ""} />
        <div class="tpl-mini"><iframe src="${previewSrc(t)}" loading="lazy" title="${esc(t.name)}"></iframe></div>
        <div class="tpl-cap">${esc(t.name)}</div>
      </label>`
        )
        .join("")}
    </div>
    <details style="margin-top:10px"><summary class="muted">Advanced per-card overrides</summary>
      <div class="grid2" style="margin-top:10px">
        <div><label>Layout override</label><select name="layout"><option value="">(inherit)</option>${LAYOUTS.map(
          (x) => `<option ${c.layout === x ? "selected" : ""}>${x}</option>`
        ).join("")}</select></div>
        <div><label>Primary color override</label><input name="primaryColor" value="${esc(c.primaryColor)}" placeholder="#1f6f43" /></div>
      </div>
      <label>Logo override</label><input type="file" name="logoFile" accept="image/*" />
      <input name="logoUrl" value="${esc(c.logoUrl)}" placeholder="…or logo URL" style="margin-top:6px" />
      <label>QR code on this card</label>
      <select name="showQr">
        <option value="">Inherit brand setting</option>
        <option value="1" ${c.showQr === true ? "selected" : ""}>Show</option>
        <option value="0" ${c.showQr === false ? "selected" : ""}>Hide</option>
      </select>
    </details>

    <h3>Self-service</h3>
    <label>Owner email <span class="muted">(matched to their Azure AD sign-in at /me)</span></label>
    <input name="ownerEmail" value="${esc(c.ownerEmail)}" placeholder="person@yourco.com" />
    <label>What this person can edit on their own card</label>
    ${selfFieldChecks(effectiveSelf, { name: "selfEditFields", includeInherit: true, inherit: inheritSelf })}

    <p style="margin-top:16px">
      <button class="btn" type="submit">Save ${esc(lower(t.cardSingular))}</button>
      ${opts.card ? `<a class="btn secondary" href="/c/${esc(opts.card.slug)}" target="_blank">Preview</a>` : ""}
      <a class="btn secondary" href="/admin/cards?locationId=${esc(opts.locationId)}">Cancel</a>
      ${opts.card ? `<a class="btn secondary" href="/admin/cards/${esc(opts.card.id)}/signature">Email signature</a>` : ""}
      ${opts.card ? `<a class="btn secondary" href="/admin/cards/${esc(opts.card.id)}/turnover">Turn over</a>` : ""}
    </p>
  </form>
  ${
    opts.card
      ? `<form method="POST" action="/admin/cards/${esc(opts.card.id)}/delete" style="margin-top:10px"
           onsubmit="return confirm('Delete this ${esc(lower(t.cardSingular))}?')">
           <button class="btn danger" type="submit">Delete ${esc(lower(t.cardSingular))}</button></form>`
      : ""
  }
  ${editorScripts()}`;
  return shell(`${t.cardSingular} editor`, body);
}

// Turnover / offboarding page for a single card.
export function turnoverForm(opts: { card: any; rooftop: any; otherCards: any[]; leadCount: number }): string {
  const c = opts.card;
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ") || "this employee";
  const nameOf = (o: any) => [o.firstName, o.lastName].filter(Boolean).join(" ");
  const redirectCardOpts = opts.otherCards
    .map((o) => `<option value="card:${esc(o.slug)}">${esc(nameOf(o))}${o.title ? ` — ${esc(o.title)}` : ""}</option>`)
    .join("");
  const leadTargetOpts = opts.otherCards.map((o) => `<option value="${esc(o.id)}">${esc(nameOf(o))}</option>`).join("");
  const body = `
  <h2>Turn over — ${esc(fullName)}</h2>
  <p class="muted">Offboarding disables the public card, revokes this person's self-service access, and preserves their analytics. Leads stay unless you transfer them.</p>
  <form class="editor" method="POST" action="/admin/cards/${esc(c.id)}/turnover" style="max-width:640px">
    <h3>Redirect the old card</h3>
    <p class="muted">Where to send anyone scanning the printed NFC/QR card afterwards.</p>
    <select name="redirect">
      <option value="none">Don't redirect (show "not found")</option>
      ${opts.rooftop?.website ? `<option value="rooftop">Rooftop website (${esc(opts.rooftop.website)})</option>` : ""}
      ${redirectCardOpts ? `<optgroup label="Another card">${redirectCardOpts}</optgroup>` : ""}
    </select>

    <h3 style="margin-top:16px">Leads (${opts.leadCount})</h3>
    <select name="transferLeads">
      <option value="keep">Keep leads on this card</option>
      ${leadTargetOpts ? `<optgroup label="Transfer to">${leadTargetOpts}</optgroup>` : ""}
    </select>

    <h3 style="margin-top:16px">Replacement <span class="muted">(optional)</span></h3>
    <label class="chk"><input type="checkbox" name="createReplacement" value="1" /> Create a replacement card with this card's role, design, department and ${esc("rooftop")}</label>
    <div class="grid2" style="margin-top:8px">
      <div><label>First name</label><input name="newFirstName" /></div>
      <div><label>Last name</label><input name="newLastName" /></div>
    </div>
    <label>New owner email (self-service)</label><input name="newOwnerEmail" type="email" placeholder="new.hire@dealer.com" />

    <p style="margin-top:16px">
      <button class="btn danger" type="submit" onclick="return confirm('Offboard ${esc(fullName)}? The public card will be disabled.')">Offboard employee</button>
      <a class="btn secondary" href="/admin/cards/${esc(c.id)}/edit">Cancel</a>
    </p>
  </form>`;
  return shell("Turn over", body);
}

// Security (two-factor) settings, in the standard admin layout.
export function securityView(opts: { email: string | null; on: boolean; note?: string }): string {
  const inner = !opts.email
    ? `<p class="muted">You're signed in with the break-glass token, which has no stored account. Two-factor applies to email/password admin accounts.</p>`
    : opts.on
    ? `<p>Two-factor authentication is <strong>on</strong> for ${esc(opts.email)}.</p>
       <form method="POST" action="/admin/security/mfa/disable" style="margin-top:8px"><button class="btn danger" type="submit">Turn off two-factor</button></form>`
    : `<p>Two-factor authentication is <strong>off</strong>. Add an authenticator app for an extra layer of protection.</p>
       <form method="POST" action="/admin/security/mfa/start" style="margin-top:8px"><button class="btn" type="submit">Set up two-factor</button></form>`;
  const body = `
  <h2>Security</h2>
  ${opts.note || ""}
  <div class="stat" style="max-width:560px">${inner}</div>
  <p style="margin-top:14px"><a class="btn secondary" href="/admin">← Back</a></p>`;
  return shell("Security", body);
}

// Two-factor enrollment (QR + confirm), in the standard admin layout.
export function mfaSetupView(qr: string, secret: string, error?: string): string {
  const body = `
  <h2>Set up two-factor</h2>
  <div class="stat" style="max-width:520px">
    ${error ? `<p style="color:#b91c1c">${esc(error)}</p>` : ""}
    <p class="muted">Scan this with your authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code to confirm.</p>
    <p style="text-align:center;margin:12px 0"><img src="${esc(qr)}" alt="QR code" width="200" height="200" style="background:#fff;padding:8px;border:1px solid #e5e7eb;border-radius:8px" /></p>
    <p class="muted" style="text-align:center;word-break:break-all">Or enter the key manually: <code>${esc(secret)}</code></p>
    <form class="editor" method="POST" action="/admin/security/mfa/enable" style="margin-top:8px">
      <label>Confirmation code</label>
      <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autofocus style="max-width:160px" />
      <p style="margin-top:12px"><button class="btn" type="submit">Confirm &amp; enable</button>
      <a class="btn secondary" href="/admin/security">Cancel</a></p>
    </form>
  </div>`;
  return shell("Set up two-factor", body);
}

// Admin email-signature preview page (block rendered by the route).
export function signaturePreviewView(fullName: string, cardId: string, block: string): string {
  return shell(
    "Email signature",
    `
  <h2>Email signature — ${esc(fullName)}</h2>
  <p class="muted">A branded signature generated from this card. Paste it into Gmail / Outlook signature settings.</p>
  ${block}
  <p style="margin-top:14px"><a class="btn secondary" href="/admin/cards/${esc(cardId)}/edit">← Back to card</a></p>`
  );
}

const pq = (s: any) => encodeURIComponent(s || "");
function previewSrc(t: any): string {
  return `/preview/card?layout=${pq(t.layout)}&primary=${pq(t.primaryColor)}&text=${pq(
    t.textColor
  )}&bg=${pq(t.bgColor)}&font=${pq(t.font)}`;
}

export function templatesGallery(brandName: string, brandId: string, templates: any[]): string {
  const cards = templates.length
    ? templates
        .map(
          (t) => `<div class="tpl-card">
        <div class="tpl-frame"><iframe src="${previewSrc(t)}" loading="lazy" title="${esc(t.name)}"></iframe></div>
        <div class="tpl-name">${esc(t.name)}${t.isDefault ? ` · <span class="muted">default</span>` : ""}</div>
        <p><a href="/admin/templates/${esc(t.id)}/edit">Edit</a>
        &nbsp;·&nbsp;
        <form method="POST" action="/admin/templates/${esc(t.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this template? Cards using it fall back to the brand design.')"><button class="btn danger" type="submit" style="padding:3px 9px">Delete</button></form></p>
      </div>`
        )
        .join("")
    : `<p class="muted">No templates yet. Create one so your team can pick a ready-made design when making a card.</p>`;

  const body = `
  <div class="topbar">
    <h2>Templates — ${esc(brandName)}</h2>
    <a class="btn" href="/admin/templates/new?brandId=${esc(brandId)}">+ New template</a>
  </div>
  <p class="muted">A template fixes a layout, color theme and font once. Cards then just pick a template — no design fiddling per person.</p>
  <div class="tpl-grid">${cards}</div>
  <p style="margin-top:16px"><a class="btn secondary" href="/admin">← Back</a></p>`;
  return shell("Templates", body);
}

export function templateForm(brandId: string, template?: any): string {
  const t = template || {};
  const locked = new Set(asStringArray(t.lockedFields));
  const hidden = new Set(asStringArray(t.hiddenFields));
  const action = template ? `/admin/templates/${template.id}` : "/admin/templates";
  const body = `
  <h2>${template ? "Edit" : "New"} template</h2>
  <form class="editor" method="POST" action="${action}" style="max-width:900px">
    <input type="hidden" name="brandId" value="${esc(brandId)}" />
    <label>Template name</label>
    <input name="name" value="${esc(t.name)}" required placeholder="e.g. Sales — Green Wave" />
    <label class="chk" style="margin:10px 0"><input type="checkbox" name="isDefault" value="1" ${
      t.isDefault ? "checked" : ""
    } /> Use as the default design for new cards in this brand</label>
    <h3>Design</h3>
    ${designControls({
      layout: t.layout,
      primaryColor: t.primaryColor,
      textColor: t.textColor,
      bgColor: t.bgColor,
      font: t.font,
    })}

    <h3 style="margin-top:20px">Role behavior <span class="muted">(optional)</span></h3>
    <label>Role name</label>
    <input name="role" list="role-suggest" value="${esc(t.role)}" placeholder="e.g. Service Advisor" />
    <datalist id="role-suggest">${ROLE_SUGGESTIONS.map((r) => `<option value="${esc(r)}"></option>`).join("")}</datalist>

    <label style="margin-top:12px">Lock fields from self-editing <span class="muted">(employees can't change these)</span></label>
    <div class="self-fields">${SELF_FIELDS.map(
      ([v, l]) =>
        `<label class="chk"><input type="checkbox" name="lockedFields" value="${esc(v)}" ${
          locked.has(v) ? "checked" : ""
        } /> ${esc(l)}</label>`
    ).join("")}</div>

    <label style="margin-top:12px">Hide fields on the public card</label>
    <div class="self-fields">${HIDEABLE_FIELDS.map(
      ([v, l]) =>
        `<label class="chk"><input type="checkbox" name="hiddenFields" value="${esc(v)}" ${
          hidden.has(v) ? "checked" : ""
        } /> ${esc(l)}</label>`
    ).join("")}</div>

    <label class="chk" style="margin:12px 0"><input type="checkbox" name="leadCapture" value="1" ${
      t.leadCapture !== false ? "checked" : ""
    } /> Show the "share your details back" lead form</label>

    <label>QR code on the card</label>
    <select name="showQr">
      <option value="">(inherit brand)</option>
      <option value="1" ${t.showQr === true ? "selected" : ""}>Show</option>
      <option value="0" ${t.showQr === false ? "selected" : ""}>Hide</option>
    </select>

    <label style="margin-top:12px">Role CTA buttons <span class="muted">(one per line: <code>Label | https://url</code>)</span></label>
    <textarea name="roleCtas" rows="2" placeholder="Text me | sms:+15551234567">${esc(ctaLinesFromJson(t.roleCtas))}</textarea>

    <label style="margin-top:12px">Disclaimer <span class="muted">(shown on the card)</span></label>
    <textarea name="disclaimer" rows="2" placeholder="Prices exclude tax, title, and license.">${esc(t.disclaimer)}</textarea>

    <label style="margin-top:12px">Email signature <span class="muted">(tokens: ${SIGNATURE_TOKENS.map(
      (x) => "{{" + x + "}}"
    ).join(", ")})</span></label>
    <textarea name="emailSignature" rows="4" placeholder="{{fullName}} — {{title}}&#10;{{company}} · {{phone}}&#10;{{cardUrl}}">${esc(
      t.emailSignature
    )}</textarea>

    <h3 style="margin-top:20px">Lead form</h3>
    ${leadFormConfig({
      fields: Array.isArray(t.leadFields) ? asStringArray(t.leadFields) : DEFAULT_LEAD_FIELDS,
      consentText: t.leadConsentText,
      inheritName: "leadInherit",
      inheritLabel: "Inherit the lead form from the brand",
      inherit: t.leadFields == null,
    })}

    <p style="margin-top:16px"><button class="btn" type="submit">Save template</button>
    <a class="btn secondary" href="/admin/templates?brandId=${esc(brandId)}">Cancel</a></p>
  </form>
  ${designScripts()}`;
  return shell("Template", body);
}

export function adminsView(admins: any[]): string {
  const rows = admins.length
    ? admins
        .map((a) => {
          const scopes = a.scopes || [];
          const scopeTxt =
            a.role === "brand_admin"
              ? `${scopes.filter((s: any) => s.brandId).length} brand(s)`
              : a.role === "location_admin"
              ? `${scopes.filter((s: any) => s.locationId).length} store(s)`
              : "all";
          const mfa = a.passwordHash
            ? a.mfaEnabled
              ? `<span class="pill on">MFA on</span>`
              : `<span class="pill off">MFA pending</span>`
            : `<span class="muted">SSO</span>`;
          return `<tr>
        <td>${esc(a.email)}</td><td>${esc(a.name || "")}</td>
        <td>${esc(ROLE_LABELS[a.role as keyof typeof ROLE_LABELS] || a.role)}</td>
        <td class="muted">${esc(scopeTxt)}</td>
        <td>${mfa}</td>
        <td>${a.active ? `<span class="pill on">active</span>` : `<span class="pill off">disabled</span>`}</td>
        <td><a href="/admin/admins/${esc(a.id)}/edit">Edit</a></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">No admin accounts yet. The ADMIN_TOKEN is the bootstrap super admin.</td></tr>`;
  const body = `
  <div class="topbar"><h2>Admin accounts</h2><a class="btn" href="/admin/admins/new">+ New admin</a></div>
  <p class="muted">Super (everything), General (all brands' content), Brand (assigned brands), Store (assigned stores' cards). SSO admins get MFA from your IdP; password admins enroll an authenticator app on first sign-in.</p>
  <table><tr><th>Email</th><th>Name</th><th>Role</th><th>Scope</th><th>2FA</th><th>Status</th><th></th></tr>${rows}</table>
  <p style="margin-top:14px"><a class="btn secondary" href="/admin">← Back</a></p>`;
  return shell("Admins", body);
}

export function adminForm(opts: { admin?: any; brands: any[]; locations: any[] }): string {
  const a = opts.admin || {};
  const action = opts.admin ? `/admin/admins/${a.id}` : "/admin/admins";
  const scopes = a.scopes || [];
  const brandSet = new Set(scopes.filter((s: any) => s.brandId).map((s: any) => s.brandId));
  const locSet = new Set(scopes.filter((s: any) => s.locationId).map((s: any) => s.locationId));
  const roles = ["org_owner", "org_admin", "brand_admin", "location_admin"] as const;
  const body = `
  <h2>${opts.admin ? "Edit" : "New"} admin</h2>
  <form class="editor" method="POST" action="${action}" style="max-width:640px">
    <label>Email</label><input name="email" type="email" value="${esc(a.email)}" ${
    opts.admin ? "readonly" : ""
  } required />
    <label>Name</label><input name="name" value="${esc(a.name)}" />
    <label>Role</label>
    <select name="role" id="role-sel">${roles
      .map((r) => `<option value="${r}" ${a.role === r ? "selected" : ""}>${esc(ROLE_LABELS[r])}</option>`)
      .join("")}</select>

    <div id="brand-scope" class="scope-box">
      <label>Brand scope (for Brand admin)</label>
      <div class="self-fields">${opts.brands
        .map(
          (b: any) =>
            `<label class="chk"><input type="checkbox" name="brandScope" value="${esc(b.id)}" ${
              brandSet.has(b.id) ? "checked" : ""
            } /> ${esc(b.name)}</label>`
        )
        .join("")}</div>
    </div>
    <div id="loc-scope" class="scope-box">
      <label>Store scope (for Store admin)</label>
      <div class="self-fields">${opts.locations
        .map(
          (l: any) =>
            `<label class="chk"><input type="checkbox" name="locationScope" value="${esc(l.id)}" ${
              locSet.has(l.id) ? "checked" : ""
            } /> ${esc(l.brand?.name || "")} — ${esc(l.name)}</label>`
        )
        .join("")}</div>
    </div>

    <label>Password ${opts.admin ? "(leave blank to keep current)" : "(for password login; blank = SSO-only)"}</label>
    <input name="password" type="password" autocomplete="new-password" />
    ${
      opts.admin
        ? `<label class="chk" style="margin-top:8px"><input type="checkbox" name="active" value="1" ${
            a.active ? "checked" : ""
          } /> Active</label>
    <label class="chk"><input type="checkbox" name="resetMfa" value="1" /> Reset two-factor (force re-enroll)</label>`
        : ""
    }
    <p style="margin-top:14px"><button class="btn" type="submit">Save admin</button>
    <a class="btn secondary" href="/admin/admins">Cancel</a></p>
  </form>
  ${
    opts.admin
      ? `<form method="POST" action="/admin/admins/${esc(
          a.id
        )}/delete" onsubmit="return confirm('Delete this admin account?')" style="margin-top:10px"><button class="btn danger" type="submit">Delete admin</button></form>`
      : ""
  }
  <script>(function(){var s=document.getElementById('role-sel'),bs=document.getElementById('brand-scope'),ls=document.getElementById('loc-scope');function u(){bs.style.display=s.value==='brand_admin'?'block':'none';ls.style.display=s.value==='location_admin'?'block':'none';}s.addEventListener('change',u);u();})();</script>`;
  return shell("Admin", body);
}

export function integrationsView(data: {
  keys: any[];
  endpoints: any[];
  events: readonly string[];
  newKey?: string | null;
  baseUrl: string;
  saml: any;
  samlIssuer: string;
  samlAcsUrl: string;
  samlHost: string | null;
  subdomain: string | null;
  customDomain: string | null;
  platformDomain: string;
  scimBaseUrl: string;
  scimTokenSet: boolean;
  newScimToken?: string | null;
}): string {
  const keyScopes = (k: any) => {
    const s = Array.isArray(k.scopes) ? k.scopes : [];
    if (!s.length) return `<span class="muted">full access</span>`;
    return s.map((x: string) => `<span class="pill">${esc(x)}</span>`).join(" ");
  };
  const keyRows = data.keys.length
    ? data.keys
        .map(
          (k) => `<tr>
        <td>${esc(k.name)}</td>
        <td class="muted"><code>${esc(k.prefix)}…</code></td>
        <td style="max-width:220px">${keyScopes(k)}</td>
        <td class="muted">${k.lastUsedAt ? `${esc(new Date(k.lastUsedAt).toISOString().slice(0, 16).replace("T", " "))}${k.lastUsedPath ? `<br><span style="font-size:11px">${esc(k.lastUsedPath)}</span>` : ""}` : "never"}</td>
        <td>${k.revoked ? `<span class="pill off">revoked</span>` : `<span class="pill on">active</span>`}</td>
        <td>${
          k.revoked
            ? ""
            : `<form method="POST" action="/admin/api-keys/${esc(k.id)}/revoke" onsubmit="return confirm('Revoke this key? Apps using it will stop working.')"><button class="btn danger" type="submit">Revoke</button></form>`
        }</td></tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="muted">No API keys yet.</td></tr>`;

  const epRows = data.endpoints.length
    ? data.endpoints
        .map((e) => {
          const last = e.deliveries && e.deliveries[0];
          const events = Array.isArray(e.events) ? e.events : [];
          return `<tr>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis"><code>${esc(e.url)}</code></td>
        <td class="muted">${esc(events.join(", "))}</td>
        <td>${e.active ? `<span class="pill on">active</span>` : `<span class="pill off">off</span>`}</td>
        <td class="muted">${
          last
            ? `${last.success ? "✓" : "✗"} ${last.statusCode || ""} ${esc(
                new Date(last.createdAt).toISOString().slice(11, 16)
              )}`
            : "—"
        }</td>
        <td><details><summary class="muted">secret</summary><code style="font-size:11px">${esc(e.secret)}</code></details></td>
        <td style="white-space:nowrap"><a class="btn secondary" href="/admin/webhooks/${esc(e.id)}">Inspect</a>
        <form method="POST" action="/admin/webhooks/${esc(e.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this webhook?')"><button class="btn danger" type="submit">Delete</button></form></td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="muted">No webhook endpoints yet.</td></tr>`;

  const eventChecks = data.events
    .map((ev) => `<label class="chk"><input type="checkbox" name="events" value="${esc(ev)}" ${ev === "lead.captured" ? "checked" : ""} /> ${esc(ev)}</label>`)
    .join("");
  const saml = data.saml || {};

  const body = `
  <h2>Integrations</h2>

  ${
    data.newKey
      ? `<div class="stat" style="border:1px solid #16a34a;background:#f0fdf4;margin-bottom:16px">
      <strong>New API key created — copy it now, it won't be shown again:</strong>
      <p><code style="font-size:14px;word-break:break-all">${esc(data.newKey)}</code></p>
    </div>`
      : ""
  }

  <h3>REST API</h3>
  <p class="muted">Base URL: <code>${esc(data.baseUrl)}/api/v1</code>. Authenticate with <code>Authorization: Bearer &lt;key&gt;</code>.</p>
  <table>
    <tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th>Status</th><th></th></tr>
    ${keyRows}
  </table>
  <form class="editor" method="POST" action="/admin/api-keys" style="margin-top:12px;max-width:560px">
    <label>Create API key — name</label>
    <input name="name" placeholder="e.g. Zapier, CRM sync" required />
    <label style="margin-top:10px">Permissions <span class="muted">(leave all unchecked for full access)</span></label>
    <div class="self-fields">${API_SCOPES.map(
      (s) => `<label class="chk"><input type="checkbox" name="scopes" value="${esc(s)}" /> ${esc(SCOPE_LABELS[s])}</label>`
    ).join("")}</div>
    <p style="margin-top:10px"><button class="btn" type="submit">Create key</button></p>
  </form>

  <h3 style="margin-top:28px">SAML single sign-on</h3>
  <div class="stat" style="margin-bottom:12px">
    <p style="margin:0 0 8px">Status: ${
      saml.enabled
        ? `<span class="pill on">enabled</span>`
        : `<span class="pill off">disabled</span>`
    }</p>
    ${
      data.samlHost
        ? `<p class="muted" style="margin:0 0 6px">Give these to your identity provider (Okta, Entra, Google Workspace, etc.):</p>
    <p class="muted">SP entity ID: <code>${esc(data.samlIssuer)}</code></p>
    <p class="muted">ACS / reply URL: <code>${esc(data.samlAcsUrl)}</code></p>
    <p class="muted">Your team signs in at: <code>https://${esc(data.samlHost)}/me/login</code></p>`
        : `<p class="muted" style="margin:0;color:#b45309">Set a workspace address (subdomain or custom domain) below first — your IdP needs a stable reply URL tied to this tenant.</p>`
    }
  </div>
  <form class="editor" method="POST" action="/admin/saml-config" style="margin-top:12px;max-width:760px">
    <label>Workspace subdomain ${
      data.platformDomain
        ? `<span class="muted">(team signs in at &lt;name&gt;.${esc(data.platformDomain)})</span>`
        : ""
    }</label>
    <input name="subdomain" value="${esc(data.subdomain || "")}" placeholder="acme" />
    <label style="margin-top:10px">Custom domain <span class="muted">(optional; overrides subdomain)</span></label>
    <input name="customDomain" value="${esc(data.customDomain || "")}" placeholder="cards.acmecorp.com" />
    <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb" />
    <label class="chk"><input type="checkbox" name="enabled" value="1" ${
      saml.enabled ? "checked" : ""
    } /> Enable SAML sign-in</label>
    <label style="margin-top:10px">IdP SSO URL</label>
    <input name="entryPoint" type="url" value="${esc(saml.entryPoint || "")}" placeholder="https://idp.example.com/sso/saml" />
    <label style="margin-top:10px">IdP issuer / entity ID <span class="muted">(optional, but recommended)</span></label>
    <input name="idpIssuer" value="${esc(saml.idpIssuer || "")}" placeholder="https://idp.example.com/entity-id" />
    <label style="margin-top:10px">IdP signing certificate</label>
    <textarea name="idpCert" rows="8" placeholder="-----BEGIN CERTIFICATE-----...">${esc(
      saml.idpCert || ""
    )}</textarea>
    <p style="margin-top:10px"><button class="btn" type="submit">Save SSO settings</button></p>
  </form>

  <h3 style="margin-top:28px">SCIM provisioning</h3>
  ${
    data.newScimToken
      ? `<div class="stat" style="border:1px solid #16a34a;background:#f0fdf4;margin-bottom:12px"><strong>New SCIM token — copy it now, it won't be shown again:</strong><p><code style="font-size:14px;word-break:break-all">${esc(
          data.newScimToken
        )}</code></p></div>`
      : ""
  }
  <div class="stat" style="margin-bottom:12px">
    <p style="margin:0 0 6px">Token: ${data.scimTokenSet ? `<span class="pill on">configured</span>` : `<span class="pill off">not set</span>`}</p>
    <p class="muted" style="margin:0">Tenant URL (SCIM 2.0): <code>${esc(data.scimBaseUrl)}</code></p>
    <p class="muted">In Entra/Okta, set the Tenant URL above and paste the generated token as the Secret Token. Provisioned users land in this org only.</p>
  </div>
  <form method="POST" action="/admin/scim-token/generate" onsubmit="return confirm('${
    data.scimTokenSet ? "Regenerate the SCIM token? The current token will stop working." : "Generate a SCIM token?"
  }')">
    <button class="btn" type="submit">${data.scimTokenSet ? "Regenerate token" : "Generate token"}</button>
  </form>

  <h3 style="margin-top:28px">Webhooks</h3>
  <p class="muted">We POST signed JSON to your URL on each subscribed event. Verify with the <code>X-OpenCard-Signature</code> header (HMAC-SHA256 of the body, using the endpoint secret).</p>
  <table>
    <tr><th>URL</th><th>Events</th><th>Status</th><th>Last delivery</th><th>Secret</th><th></th></tr>
    ${epRows}
  </table>
  <form class="editor" method="POST" action="/admin/webhooks" style="margin-top:12px;max-width:560px">
    <label>Endpoint URL</label>
    <input name="url" type="url" placeholder="https://example.com/hooks/opencard" required />
    <label>Events</label>
    <div class="self-fields">${eventChecks}</div>
    <p style="margin-top:10px"><button class="btn" type="submit">Add webhook</button></p>
  </form>

  <p style="margin-top:18px"><a class="btn secondary" href="/admin">← Back</a></p>`;
  return shell("Integrations", body);
}

function prettyJson(s: string | null | undefined): string {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

const PRE =
  'style="white-space:pre-wrap;word-break:break-word;background:#f6f8fa;border:1px solid #e5e7eb;padding:10px;border-radius:6px;font-size:12px;max-height:280px;overflow:auto;margin:6px 0"';

// Delivery inspector for a single webhook endpoint.
export function webhookDetailView(data: {
  endpoint: any;
  deliveries: any[];
  filter: "all" | "failed";
  flash?: string | null;
}): string {
  const ep = data.endpoint;
  const events = Array.isArray(ep.events) ? (ep.events as string[]) : [];
  const statusPill = (d: any) =>
    d.error && d.statusCode == null
      ? `<span class="pill off">error</span>`
      : d.success
      ? `<span class="pill on">✓ ${d.statusCode}</span>`
      : `<span class="pill off">✗ ${d.statusCode ?? ""}</span>`;

  const rows = data.deliveries.length
    ? data.deliveries
        .map((d) => {
          const when = new Date(d.createdAt).toISOString().slice(0, 19).replace("T", " ");
          const respHeaders = d.responseHeaders ? JSON.stringify(d.responseHeaders, null, 2) : "";
          return `<tr>
        <td class="muted" style="white-space:nowrap">${esc(when)}</td>
        <td><code>${esc(d.event)}</code></td>
        <td>#${d.attempt ?? 1}</td>
        <td>${statusPill(d)}</td>
        <td class="muted">${d.durationMs != null ? d.durationMs + " ms" : "—"}</td>
        <td><details><summary class="muted">inspect</summary>
          <div style="padding:8px 0;max-width:640px">
            <p style="margin:4px 0"><strong>Request</strong> — signature <code style="font-size:11px;word-break:break-all">${esc(
              d.signature || ""
            )}</code></p>
            <pre ${PRE}>${esc(prettyJson(d.requestBody))}</pre>
            <p style="margin:8px 0 4px"><strong>Response</strong> ${
              d.statusCode != null ? `HTTP ${d.statusCode}` : ""
            }${d.error ? ` — <span style="color:#b91c1c">${esc(d.error)}</span>` : ""}</p>
            ${respHeaders ? `<pre ${PRE}>${esc(respHeaders)}</pre>` : ""}
            ${d.responseBody ? `<pre ${PRE}>${esc(d.responseBody)}</pre>` : `<p class="muted">No response body.</p>`}
            <form method="POST" action="/admin/deliveries/${esc(d.id)}/replay" style="margin-top:6px">
              <button class="btn secondary" type="submit">Replay this payload</button>
            </form>
          </div>
        </details></td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="muted">No deliveries${data.filter === "failed" ? " matching this filter" : " yet"}.</td></tr>`;

  const body = `
  <h2>Webhook deliveries</h2>
  ${data.flash ? `<div class="stat" style="border:1px solid #16a34a;background:#f0fdf4;margin-bottom:14px"><strong>${esc(data.flash)}</strong></div>` : ""}
  <div class="stat" style="margin-bottom:14px">
    <p style="margin:0 0 6px"><code>${esc(ep.url)}</code> ${
    ep.active ? `<span class="pill on">active</span>` : `<span class="pill off">off</span>`
  }</p>
    <p class="muted" style="margin:0">Subscribed events: ${esc(events.join(", ") || "—")}</p>
  </div>
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <form method="POST" action="/admin/webhooks/${esc(ep.id)}/test" style="margin:0">
      <button class="btn" type="submit">Send test event</button>
    </form>
    <span class="muted">Filter:</span>
    <a class="btn secondary" href="/admin/webhooks/${esc(ep.id)}" ${
    data.filter === "all" ? 'style="font-weight:700"' : ""
  }>All</a>
    <a class="btn secondary" href="/admin/webhooks/${esc(ep.id)}?filter=failed" ${
    data.filter === "failed" ? 'style="font-weight:700"' : ""
  }>Failures</a>
  </div>
  <table style="margin-top:14px">
    <tr><th>Time (UTC)</th><th>Event</th><th>Attempt</th><th>Status</th><th>Duration</th><th>Details</th></tr>
    ${rows}
  </table>
  <p style="margin-top:18px"><a class="btn secondary" href="/admin/integrations">← Integrations</a></p>`;
  return shell("Webhook deliveries", body);
}

export function analyticsView(stats: {
  totals: Record<string, number>;
  topCards: { name: string; slug: string; views: number }[];
}): string {
  const t = stats.totals;
  const body = `
  <h2>Analytics</h2>
  <div class="cards-grid">
    <div class="stat"><div class="n">${t.view || 0}</div><div class="muted">Card views</div></div>
    <div class="stat"><div class="n">${t.vcard || 0}</div><div class="muted">Contacts saved</div></div>
    <div class="stat"><div class="n">${t.click || 0}</div><div class="muted">Link clicks</div></div>
    <div class="stat"><div class="n">${t.connect || 0}</div><div class="muted">Leads captured</div></div>
  </div>
  <h3 style="margin-top:24px">Top cards by views</h3>
  <table>
    <tr><th>Card</th><th>Views</th><th></th></tr>
    ${
      stats.topCards.length
        ? stats.topCards
            .map(
              (c) =>
                `<tr><td>${esc(c.name)}</td><td>${c.views}</td><td><a href="/c/${esc(
                  c.slug
                )}" target="_blank">/c/${esc(c.slug)}</a></td></tr>`
            )
            .join("")
        : `<tr><td colspan="3" class="muted">No views yet.</td></tr>`
    }
  </table>
  <p style="margin-top:14px"><a class="btn secondary" href="/admin">← Back</a></p>`;
  return shell("Analytics", body);
}

export function leadsView(leads: any[], statusFilter = ""): string {
  const flags = (l: any) => {
    const f: string[] = [];
    if (l.tradeIn) f.push("trade-in");
    if (l.appointmentRequest) f.push("appt");
    if (l.consent) f.push("consent");
    return f.map((x) => `<span class="pill on" style="font-size:10px">${esc(x)}</span>`).join(" ");
  };
  const source = (l: any) => {
    const parts = [l.campaign, l.utmSource, l.device].filter(Boolean);
    return parts.length ? esc(parts.join(" · ")) : `<span class="muted">—</span>`;
  };
  const filterLink = (val: string, label: string) =>
    `<a class="btn secondary" href="/admin/leads${val ? `?status=${esc(val)}` : ""}" ${
      statusFilter === val ? 'style="font-weight:700"' : ""
    }>${esc(label)}</a>`;
  const body = `
  <div class="topbar"><h2>Captured leads</h2><a class="btn" href="/admin/leads.csv${
    statusFilter ? `?status=${esc(statusFilter)}` : ""
  }">Export CSV</a></div>
  <p style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="muted">Filter:</span>
    ${filterLink("", "All")}${LEAD_STATUSES.map((s) => filterLink(s, STATUS_LABELS[s])).join("")}</p>
  <table>
    <tr><th>When</th><th>Name</th><th>Contact</th><th>Interest</th><th>Source</th><th>Status</th><th>From</th></tr>
    ${
      leads.length
        ? leads
            .map(
              (l) => `<tr>
        <td class="muted" style="white-space:nowrap">${esc(
          new Date(l.createdAt).toISOString().slice(0, 16).replace("T", " ")
        )}</td>
        <td><a href="/admin/leads/${esc(l.id)}">${esc(l.name)}</a>${
                l.duplicateOfId ? ` <span class="pill off" style="font-size:10px">dup</span>` : ""
              }${l.company ? `<br><span class="muted" style="font-size:11px">${esc(l.company)}</span>` : ""}</td>
        <td style="font-size:12px">${esc(l.email || "")}${l.email && l.phone ? "<br>" : ""}${esc(l.phone || "")}${
                l.preferredContact ? `<br><span class="muted">prefers ${esc(l.preferredContact)}</span>` : ""
              }</td>
        <td style="font-size:12px">${esc(l.vehicleInterest || l.serviceNeed || "")}${
                (l.vehicleInterest || l.serviceNeed) && flags(l) ? "<br>" : ""
              }${flags(l)}</td>
        <td style="font-size:12px">${source(l)}</td>
        <td><span class="pill ${l.status === "new" ? "on" : "off"}">${esc(STATUS_LABELS[l.status] || l.status || "new")}</span>${
                l.assignedTo ? `<br><span class="muted" style="font-size:11px">${esc(l.assignedTo)}</span>` : ""
              }</td>
        <td>${
          l.card
            ? `<a href="/c/${esc(l.card.slug)}" target="_blank">${esc(l.card.firstName)} ${esc(l.card.lastName)}</a>${
                l.card.department ? `<br><span class="muted" style="font-size:11px">${esc(l.card.department)}</span>` : ""
              }`
            : l.asset
            ? `<a href="/a/${esc(l.asset.slug)}" target="_blank">${esc(l.asset.name)}</a><br><span class="muted" style="font-size:11px">asset</span>`
            : `<span class="muted">—</span>`
        }</td></tr>`
            )
            .join("")
        : `<tr><td colspan="7" class="muted">No leads captured yet.</td></tr>`
    }
  </table>
  <p style="margin-top:14px"><a class="btn secondary" href="/admin">← Back</a></p>`;
  return shell("Leads", body);
}

// Lead detail: full record + lifecycle controls (status/assign/note) + history.
export function leadDetailView(data: { lead: any; events: any[] }): string {
  const l = data.lead;
  const src = l.card
    ? `<a href="/c/${esc(l.card.slug)}" target="_blank">${esc(l.card.firstName)} ${esc(l.card.lastName)}</a> (card)`
    : l.asset
    ? `<a href="/a/${esc(l.asset.slug)}" target="_blank">${esc(l.asset.name)}</a> (asset)`
    : "—";
  const nexts = nextStatuses(l.status);
  const field = (label: string, val: any) =>
    val ? `<p style="margin:2px 0"><span class="muted">${esc(label)}:</span> ${esc(String(val))}</p>` : "";
  const when = (d: any) => esc(new Date(d).toISOString().slice(0, 16).replace("T", " "));
  const eventRows = data.events.length
    ? data.events
        .map((e) => {
          const desc =
            e.type === "status"
              ? `Status ${esc(e.fromValue || "—")} → <strong>${esc(e.toValue || "—")}</strong>`
              : e.type === "assign"
              ? `Assigned to <strong>${esc(e.toValue || "(unassigned)")}</strong>`
              : `Note: ${esc(e.note || "")}`;
          return `<tr><td class="muted" style="white-space:nowrap">${when(e.createdAt)}</td><td>${desc}</td><td class="muted">${esc(
            e.actor || ""
          )}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="3" class="muted">No history yet.</td></tr>`;

  const body = `
  <h2>Lead — ${esc(l.name)}</h2>
  ${
    l.duplicateOfId
      ? `<div class="stat" style="border:1px solid #d97706;background:#fffbeb;margin-bottom:12px"><strong>Possible duplicate</strong> of an earlier lead — <a href="/admin/leads/${esc(
          l.duplicateOfId
        )}">view original</a>.</div>`
      : ""
  }
  <div class="stat" style="margin-bottom:14px">
    <p style="margin:0 0 6px">Status: <span class="pill ${l.status === "new" ? "on" : "off"}">${esc(
    STATUS_LABELS[l.status] || l.status
  )}</span>${l.assignedTo ? ` · assigned to <strong>${esc(l.assignedTo)}</strong>` : ""}</p>
    <p class="muted" style="margin:0">From: ${src} · ${when(l.createdAt)}</p>
  </div>

  <div class="grid2" style="max-width:820px">
    <div class="stat"><strong>Contact</strong>
      ${field("Email", l.email)}${field("Phone", l.phone)}${field("Preferred", l.preferredContact)}${field("Company", l.company)}
      ${field("Vehicle interest", l.vehicleInterest)}${l.tradeIn ? field("Trade-in", "yes") : ""}${field("Service need", l.serviceNeed)}${
    l.appointmentRequest ? field("Appointment", "requested") : ""
  }${field("Note", l.note)}${field("Consent", l.consent ? "given" : "not given")}
    </div>
    <div class="stat"><strong>Attribution</strong>
      ${field("Campaign", l.campaign)}${field("UTM source", l.utmSource)}${field("UTM medium", l.utmMedium)}${field(
    "Device",
    l.device
  )}${field("Referrer", l.referrer)}
    </div>
  </div>

  <div class="grid2" style="max-width:820px;margin-top:14px">
    <form class="editor" method="POST" action="/admin/leads/${esc(l.id)}/status">
      <label>Change status</label>
      <select name="status">${
        nexts.length
          ? nexts.map((s) => `<option value="${esc(s)}">${esc(STATUS_LABELS[s] || s)}</option>`).join("")
          : `<option value="">(no transitions)</option>`
      }</select>
      <p style="margin-top:8px"><button class="btn" type="submit" ${nexts.length ? "" : "disabled"}>Update status</button></p>
    </form>
    <form class="editor" method="POST" action="/admin/leads/${esc(l.id)}/assign">
      <label>Assign to (handoff)</label>
      <input name="assignedTo" type="email" value="${esc(l.assignedTo)}" placeholder="rep@dealer.com" />
      <p style="margin-top:8px"><button class="btn secondary" type="submit">Assign</button></p>
    </form>
  </div>
  <form class="editor" method="POST" action="/admin/leads/${esc(l.id)}/note" style="max-width:820px;margin-top:8px">
    <label>Add a note</label>
    <textarea name="note" rows="2" required></textarea>
    <p style="margin-top:8px"><button class="btn secondary" type="submit">Add note</button></p>
  </form>

  <h3 style="margin-top:20px">History</h3>
  <table><tr><th>When</th><th>Event</th><th>By</th></tr>${eventRows}</table>
  <p style="margin-top:14px"><a class="btn secondary" href="/admin/leads">← Leads</a></p>`;
  return shell("Lead", body);
}
