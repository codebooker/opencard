import { esc, page, OC_FAVICON } from "./html";
import { Address } from "../types";
import { AdminPrincipal, ROLE_LABELS } from "../rbac";
import { showsBilling, canManageStaffTarget, Role } from "../roles";
import { PLAN_ORDER, PLANS, PlanKey } from "../plans";
import { API_SCOPES, SCOPE_LABELS } from "../api-scopes";
import { GENERAL_TERMINOLOGY, Terminology, lower, VERTICALS } from "../terminology";
import {
  photoField,
  labeledRowsField,
  socialsField,
  editorScripts,
  cardLivePreviewScript,
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
  ctaLinesFromJson,
} from "../dealership";
import { HIDEABLE_FIELDS, SIGNATURE_TOKENS, asStringArray } from "../roletemplate";
import { ASSET_TYPES, ASSET_DEST_TYPES, assetTypeLabel } from "../assets";
import { LEAD_FIELDS, DEFAULT_LEAD_FIELDS, leadFieldChoicesFor, defaultLeadFieldsFor } from "../leadform";
import { CSV_TARGETS } from "../csvimport";
import { packFor } from "../verticals";
import { svgAreaChart, svgBars } from "../charts";
import { TEMPLATE_PRESETS } from "../layouts";
import { campaignRoutingToLines } from "../routing";
import { LEAD_STATUSES, STATUS_LABELS, nextStatuses } from "../leadstatus";
import { SIGNATURE_THEMES, SIGNATURE_ELEMENTS, asLockList, SignatureTheme } from "../signature";
import { CRM_SOURCE_FIELDS } from "../crmsync";
import { auditLabel, formatAuditActor } from "../audit";
import { eventStatus, EVENT_STATUS_LABELS } from "../event";

// Shared lead-form config block for the template + brand editors.
function leadFormConfig(opts: {
  fields: string[];
  consentText: string | null;
  inheritName: string;
  inheritLabel: string;
  inherit: boolean;
  vertical?: string;
}): string {
  const set = new Set(opts.fields);
  const boxes = leadFieldChoicesFor(opts.vertical).map(
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

// Marks the nav link that best matches the current path (longest matching href
// wins, so /admin/leads/123 highlights "Leads" and /admin/brands/x highlights
// "Dashboard"). Client-side so the shell stays stateless.
const NAV_ACTIVE_SCRIPT = `<script>(function(){
  var p = location.pathname, best = null, len = -1;
  document.querySelectorAll(".site-nav a").forEach(function (a) {
    var h = a.getAttribute("href");
    if ((p === h || p.indexOf(h + "/") === 0) && h.length > len) { best = a; len = h.length; }
  });
  if (!best) best = document.querySelector('.site-nav a[href="/admin"]');
  if (best) best.classList.add("active");
})();</script>`;

function shell(title: string, body: string): string {
  return page({
    title,
    head: OC_FAVICON,
    body: `<header class="site-head">
      <div class="site-head-in">
        <a class="site-logo" href="/admin" aria-label="OpenCard"><img src="/opencard-logo.svg" alt="OpenCard" /></a>
        <nav class="site-nav" aria-label="Main">
          <a href="/admin">Dashboard</a>
          <a href="/admin/analytics">Analytics</a>
          <a href="/admin/leads">Leads</a>
        </nav>
        <div class="site-actions">
          <a class="btn secondary" href="/admin/logout">Sign out</a>
        </div>
      </div>
    </header>
    <main class="admin">
      ${body}
    </main>
    ${NAV_ACTIVE_SCRIPT}`,
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

// Platform settings (OpenCard staff): defaults applied to self-service signups.
export function platformSettingsView(cfg: { signupPlan: string; signupTrialDays: number }, saved = false): string {
  const planOpts = PLAN_ORDER.map(
    (k) => `<option value="${k}" ${cfg.signupPlan === k ? "selected" : ""}>${esc(PLANS[k].label)} — ${esc(PLANS[k].price)}</option>`
  ).join("");
  const body = `
  <p class="crumb"><a href="/admin/clients">← Clients</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>Platform settings</h2>
      <p class="muted" style="margin:0">Defaults for new accounts created through public signup. Changing these affects future signups only.</p>
    </div>
  </div>
  ${saved ? `<p class="auth-banner" style="max-width:560px">✓ Saved. New signups will use these defaults.</p>` : ""}
  <form class="editor" method="POST" action="/admin/platform" style="max-width:560px">
    <label>Plan tier for new signups</label>
    <select name="signupPlan">${planOpts}</select>
    ${planGuide()}
    <label>Trial length (days)</label>
    <input name="signupTrialDays" type="number" min="1" max="365" value="${cfg.signupTrialDays}" required />
    <p class="muted" style="margin:6px 0 0">1–365 days. Signups start in Standard billing as "trialing"; the workspace locks when the trial ends unless they subscribe (or you change their billing type).</p>
    <div class="form-actions"><button class="btn" type="submit">Save settings</button>
    <a class="btn secondary" href="/admin/clients">Cancel</a></div>
  </form>`;
  return shell("Platform settings", body);
}

// Backup & restore (OpenCard staff): list/trigger backups, per-client restore.
export function backupsView(d: {
  backups: { name: string; kind: string; manual: boolean; sizeHuman: string; mtime: Date }[];
  orgs: { id: string; name: string }[];
  flash?: string | null;
  error?: string | null;
}): string {
  const rows = d.backups.length
    ? d.backups
        .map(
          (b) => `<tr>
      <td><code style="font-size:12px">${esc(b.name)}</code></td>
      <td data-label="Kind">${b.kind === "db" ? "Database" : "Uploads"}${b.manual ? ` <span class="pill">manual</span>` : ""}</td>
      <td data-label="Size" class="muted">${esc(b.sizeHuman)}</td>
      <td data-label="Taken" class="muted">${esc(new Date(b.mtime).toISOString().slice(0, 16).replace("T", " "))} UTC</td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No backups found yet — the nightly job runs at 03:17 UTC.</td></tr>`;
  const dbBackups = d.backups.filter((b) => b.kind === "db");
  const body = `
  <p class="crumb"><a href="/admin/clients">← Clients</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>Backups</h2>
      <p class="muted" style="margin:0">Nightly at 03:17 UTC with offsite copies; manual backups stay on the server until retention sweeps them.</p>
    </div>
    <div><form method="POST" action="/admin/backups/run"><button class="btn" type="submit">Back up now</button></form></div>
  </div>
  ${d.flash ? `<p class="auth-banner" style="max-width:none">${esc(d.flash)}</p>` : ""}
  ${d.error ? `<p class="auth-error" style="max-width:none">${esc(d.error)}</p>` : ""}
  <table class="rsp">
    <tr><th>File</th><th>Kind</th><th>Size</th><th>Taken</th></tr>
    ${rows}
  </table>

  <section class="panel" style="margin-top:20px">
    <h3>Restore a client to a backup</h3>
    <p class="muted">Rewinds ONE client's content — brands, ${"rooftops/locations"}, cards, employees, leads, assets, campaigns, integrations — to the selected backup. Other clients are untouched. Not restored: the client's plan/billing, admin accounts, audit log, and uploaded images (photos deleted since the backup will show as missing). Anything the client changed after the backup is lost.</p>
    <form class="editor" method="POST" action="/admin/backups/restore-client" onsubmit="return confirm('Rewind this client to the selected backup? Changes made after it will be lost. This cannot be undone.')">
      <label>Client</label>
      <select name="orgId" required>${d.orgs.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("")}</select>
      <label>Database backup</label>
      <select name="dump" required>${dbBackups
        .map((b) => `<option value="${esc(b.name)}">${esc(new Date(b.mtime).toISOString().slice(0, 16).replace("T", " "))} UTC — ${esc(b.name)}</option>`)
        .join("")}</select>
      <label>Type the client's name to confirm</label>
      <input name="confirmName" autocomplete="off" required />
      <div class="form-actions"><button class="btn danger" type="submit">Restore this client</button></div>
    </form>
  </section>

  <section class="panel" style="border-style:dashed">
    <h3>Full-instance restore (runbook)</h3>
    <p class="muted">Restoring the ENTIRE database is deliberately not a button — it takes the platform down and replaces every tenant at once. From the VM:</p>
    <pre style="background:var(--wash-2);border:1px solid var(--line-soft);border-radius:8px;padding:12px;font-size:12px;overflow-x:auto">cd /opt/opencard
docker compose -f deploy/docker-compose.prod.yml stop web
docker exec -i opencard-db-1 psql -U opencard -c "DROP DATABASE opencard WITH (FORCE)" postgres
docker exec -i opencard-db-1 psql -U opencard -c "CREATE DATABASE opencard" postgres
docker exec -i opencard-db-1 pg_restore -U opencard -d opencard --no-owner &lt; backups/db-YYYY-MM-DD_HHMM.dump
docker compose -f deploy/docker-compose.prod.yml up -d</pre>
  </section>`;
  return shell("Backups", body);
}

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
      <td data-label="Plan">${esc(o.plan)}</td>
      <td data-label="Mode">${o.suspended ? `<span class="pill off">suspended</span>` : modePill(o.billingMode)}</td>
      <td data-label="Status" class="muted">${esc(o.subscriptionStatus)}</td>
      <td data-label="Usage" class="muted" style="font-size:12px">${o._count.brands} brands · ${o._count.cards} cards · ${o._count.leads} leads</td>
      <td class="rsp-actions" style="white-space:nowrap"><a class="btn secondary" href="/admin/clients/${esc(o.id)}/settings">Edit</a>
      <form method="POST" action="/admin/clients/${esc(o.id)}/enter" style="display:inline"><button class="btn secondary" type="submit">Manage</button></form></td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="muted">No client workspaces yet.</td></tr>`;
  const body = `
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>Clients</h2>
      <p class="muted" style="margin:0">Signed in as ${esc(p.name)} · <strong>OpenCard staff</strong></p>
    </div>
    <div>${
      p.staffAdmin
        ? `<a class="btn secondary" href="/admin/staff">Staff</a> <a class="btn secondary" href="/admin/backups">Backups</a> <a class="btn secondary" href="/admin/platform">Settings</a> `
        : ""
    }<a class="btn secondary" href="/admin/security">Security</a> <a class="btn" href="/admin/clients/new">+ New client</a></div>
  </div>
  <p class="muted">Every workspace in the system. “Manage” administers a client's brands, cards, leads and SSO; “Edit” sets its plan and seat allowance.</p>
  <table class="rsp">
    <tr><th>Client</th><th>Plan</th><th>Mode</th><th>Status</th><th>Usage</th><th></th></tr>
    ${rows}
  </table>`;
  return shell("Clients", body);
}

// OpenCard staff accounts (platform tiers). Owner/admin only.
export function staffListView(staff: any[], p: AdminPrincipal): string {
  const rows = staff.length
    ? staff
        .map((s) => {
          const canEdit = canManageStaffTarget(p.role, s.role);
          return `<tr>
      <td><strong>${esc(s.name || s.email)}</strong><br><span class="muted" style="font-size:11px">${esc(s.email)}</span></td>
      <td data-label="Role">${esc(ROLE_LABELS[s.role as Role] || s.role)}</td>
      <td data-label="2FA">${s.mfaEnabled ? `<span class="pill on">MFA on</span>` : `<span class="pill off">no MFA</span>`}</td>
      <td data-label="Status">${s.active ? `<span class="pill on">active</span>` : `<span class="pill off">disabled</span>`}</td>
      <td class="rsp-actions">${canEdit ? `<a class="btn secondary" href="/admin/staff/${esc(s.id)}/edit">Edit</a>` : `<span class="muted">—</span>`}</td>
    </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="muted">No staff accounts yet.</td></tr>`;
  const body = `
  <p class="crumb"><a href="/admin/clients">← Clients</a></p>
  <div class="topbar"><h2>OpenCard staff</h2><a class="btn" href="/admin/staff/new">+ New staff</a></div>
  <p class="muted"><strong>Owner</strong>: full control, incl. other owners. <strong>Admin</strong>: everything except managing owners. <strong>Staff</strong>: manage clients only (no staff/password admin).</p>
  <table class="rsp">
    <tr><th>Person</th><th>Role</th><th>2FA</th><th>Status</th><th></th></tr>
    ${rows}
  </table>`;
  return shell("Staff", body);
}

export function staffForm(allowedRoles: string[], staff?: any): string {
  const s = staff || {};
  const action = staff ? `/admin/staff/${esc(s.id)}` : "/admin/staff";
  const roleOpts = allowedRoles
    .map((r) => `<option value="${esc(r)}" ${s.role === r ? "selected" : ""}>${esc(ROLE_LABELS[r as Role] || r)}</option>`)
    .join("");
  const body = `
  <p class="crumb"><a href="/admin/staff">← Staff</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>${staff ? "Edit staff" : "New OpenCard staff"}</h2>
      <p class="muted" style="margin:0">${staff ? `Platform account for ${esc(s.email)}.` : "Creates a platform account with access to client workspaces."}</p>
    </div>
  </div>
  <form class="editor" method="POST" action="${action}" style="max-width:560px">
    <div class="grid2">
      <div><label>Email</label><input name="email" type="email" value="${esc(s.email)}" ${staff ? "readonly" : "required"} /></div>
      <div><label>Name</label><input name="name" value="${esc(s.name)}" placeholder="Jane Doe" /></div>
    </div>
    <label>Role</label>
    <select name="role">${roleOpts}</select>
    <p class="muted" style="margin:6px 0 0">Owner: full control, incl. other owners. Admin: everything except managing owners. Staff: manage clients only.</p>
    <label>Password ${staff ? `<span class="muted">(leave blank to keep)</span>` : ""}</label>
    <input name="password" type="password" autocomplete="new-password" />
    ${
      staff
        ? `<label class="chk" style="margin-top:12px"><input type="checkbox" name="active" value="1" ${
            s.active ? "checked" : ""
          } /> Active</label>
      <label class="chk"><input type="checkbox" name="resetMfa" value="1" /> Reset two-factor (force re-enroll)</label>`
        : ""
    }
    <div class="form-actions"><button class="btn" type="submit">${staff ? "Save changes" : "Create staff"}</button>
    <a class="btn secondary" href="/admin/staff">Cancel</a></div>
  </form>
  ${
    staff
      ? `<div class="danger-zone" style="max-width:560px">
    <h3>Delete this staff account</h3>
    <p class="muted">Removes ${esc(s.email)}'s access immediately. This cannot be undone.</p>
    <form method="POST" action="/admin/staff/${esc(s.id)}/delete" onsubmit="return confirm('Delete this staff account?')"><button class="btn danger" type="submit">Delete staff account</button></form>
  </div>`
      : ""
  }`;
  return shell(staff ? "Edit staff" : "New staff", body);
}

// One-line summary of what each plan tier includes (shown on the client form).
const PLAN_BLURBS: Record<PlanKey, string> = {
  starter: "Try-it-out tier: 1 brand, 1 location, 25 cards, lead capture only.",
  team: "Single business: self-service editing, email signatures, CSV export, API. Up to 250 cards.",
  dealer_group: "Multi-rooftop groups: everything in Team plus SSO, SCIM provisioning, webhooks, CRM sync, custom domains, advanced analytics. Up to 5,000 cards.",
  enterprise: "Everything, unlimited, plus audit logs. Custom pricing.",
};

function planGuide(): string {
  return `<div class="scope-box" style="margin-top:8px">${PLAN_ORDER.map((k) => {
    const p = PLANS[k];
    return `<p style="margin:4px 0;font-size:13px"><strong>${esc(p.label)}</strong> <span class="muted">(${esc(p.price)})</span> — <span class="muted">${esc(PLAN_BLURBS[k])}</span></p>`;
  }).join("")}</div>`;
}

// Create/edit a client (OpenCard staff): name, plan tier, billing type, seats.
export function clientForm(org?: any): string {
  const o = org || {};
  const action = org ? `/admin/clients/${esc(o.id)}/settings` : "/admin/clients";
  const planOpts = PLAN_ORDER.map(
    (k) => `<option value="${k}" ${o.plan === k ? "selected" : ""}>${esc(PLANS[k].label)} — ${esc(PLANS[k].price)}</option>`
  ).join("");
  const modeOpts = [
    ["free", "Free"],
    ["standard", "Paid"],
    ["demo", "Trial"],
  ]
    .map(([v, l]) => `<option value="${v}" ${o.billingMode === v ? "selected" : ""}>${l}</option>`)
    .join("");
  const seatVal = o.seatLimit == null ? "" : o.seatLimit < 0 ? "unlimited" : String(o.seatLimit);
  const body = `
  <p class="crumb"><a href="/admin/clients">← Clients</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>${org ? `Edit client — ${esc(o.name)}` : "New client"}</h2>
      <p class="muted" style="margin:0">${org ? "Plan tier, billing type, and the seat allowance for this workspace." : "Creates a client workspace. The client's own admins manage everything inside it."}</p>
    </div>
  </div>
  <form class="editor" method="POST" action="${action}" style="max-width:560px">
    <label>Client name</label><input name="name" value="${esc(o.name)}" required placeholder="Acme Auto Group" />
    <label>Business type</label>
    <select name="businessType">${VERTICALS.map(
      ([val, label]) =>
        `<option value="${esc(val)}" ${(o.vertical || "general") === val ? "selected" : ""}>${esc(label)}</option>`
    ).join("")}</select>
    <p class="muted" style="margin:6px 0 0">Sets the workspace's wording (e.g. Rooftops vs Locations) and which lead-form fields are offered.${
      org ? " Changing it relabels their admin UI." : ""
    }</p>
    <div class="grid2">
      <div><label>Plan tier</label><select name="plan">${planOpts}</select>
        <p class="muted" style="margin:6px 0 0">Controls the feature set.</p></div>
      <div><label>Billing type</label><select name="billingMode" id="billing-mode">${modeOpts}</select>
        <p class="muted" style="margin:6px 0 0">Trial workspaces lock after the trial ends.</p></div>
    </div>
    <div id="demo-days-wrap" style="display:none">
      <label>Trial length</label>
      <select name="demoDays"><option value="30">30 days</option><option value="60">60 days</option></select>
      <p class="muted" style="margin:6px 0 0">${org ? "Saving with Trial selected restarts the trial clock from today." : "The trial starts when the workspace is created."}</p>
    </div>
    ${planGuide()}
    <label>User allowance</label>
    <input name="seatLimit" value="${esc(seatVal)}" placeholder="e.g. 50, or unlimited" />
    <p class="muted" style="margin:6px 0 0">Blank = the plan's default · <code>unlimited</code> = per-seat billing · or a fixed number of users.</p>
    <div class="form-actions"><button class="btn" type="submit">${org ? "Save client" : "Create client"}</button>
    <a class="btn secondary" href="/admin/clients">Cancel</a></div>
  </form>
  <script>(function(){
    var m=document.getElementById('billing-mode'),w=document.getElementById('demo-days-wrap');
    if(!m||!w) return;
    function u(){ w.style.display = m.value==='demo' ? '' : 'none'; }
    m.addEventListener('change',u); u();
  })();</script>
  ${
    org
      ? `<div class="danger-zone" style="max-width:560px">
    <h3>${o.suspended ? "Workspace is suspended" : "Suspend this client"}</h3>
    <p class="muted">${
      o.suspended
        ? "Everything is dark: their admins see a suspension notice, self-service and the API are blocked, and public cards, QR codes and campaign links stop resolving. Unsuspend to restore everything as it was."
        : "Immediately takes the workspace dark — admin access, self-service, the API, and all public cards, QR codes and campaign links. No data is deleted; unsuspend restores everything."
    }</p>
    <form method="POST" action="/admin/clients/${esc(o.id)}/suspend" onsubmit="return confirm('${
      o.suspended ? "Unsuspend" : "Suspend"
    } ${esc(o.name)}?')">
      <button class="btn ${o.suspended ? "" : "danger"}" type="submit">${o.suspended ? "Unsuspend client" : "Suspend client"}</button>
    </form>
    <h3 style="margin-top:20px">Delete this client</h3>
    <p class="muted">Permanently deletes <strong>${esc(o.name)}</strong>: every brand, rooftop, card, lead, asset, campaign, integration, admin account and audit entry. This cannot be undone — consider suspending instead.</p>
    <form method="POST" action="/admin/clients/${esc(o.id)}/delete" onsubmit="return confirm('Permanently delete ${esc(
      o.name
    )} and ALL of its data? This cannot be undone.')">
      <label>Type the client name to confirm: <strong>${esc(o.name)}</strong></label>
      <input name="confirmName" autocomplete="off" placeholder="${esc(o.name)}" />
      <button class="btn danger" type="submit">Delete client permanently</button>
    </form>
  </div>`
      : ""
  }`;
  return shell(org ? "Edit client" : "New client", body);
}

// First-run checklist state, computed from real data in the dashboard route.
export type OnboardingState = {
  steps: { brand: boolean; location: boolean; card: boolean; shared: boolean; lead: boolean };
  firstBrandId: string | null;
  firstCard: { slug: string; locationId: string } | null;
};

export function dashboard(
  brands: BrandWithLocations[],
  p: AdminPrincipal,
  t: Terminology = GENERAL_TERMINOLOGY,
  actingClientName?: string,
  verifyState: "needed" | "sent" | null = null,
  onboarding: OnboardingState | null = null
): string {
  const canManage = (brandId: string) =>
    p.global || (p.role === "brand_admin" && p.brandIds.includes(brandId));
  const topActions = `
    ${showsBilling(p) ? `<a class="btn secondary" href="/admin/billing">Plan</a>` : ""}
    <a class="btn secondary" href="/admin/security">Security</a>
    <a class="btn secondary" href="/admin/domains">Domains</a>
    ${p.super ? `<a class="btn secondary" href="/admin/admins">Admins</a>` : ""}
    ${p.super ? `<a class="btn secondary" href="/admin/integrations">Integrations</a>` : ""}
    ${p.super ? `<a class="btn secondary" href="/admin/import">Import</a>` : ""}
    ${p.super ? `<a class="btn secondary" href="/admin/marketing">Marketing</a>` : ""}
    ${p.super ? `<a class="btn secondary" href="/admin/audit">Audit</a>` : ""}
    ${p.global ? `<a class="btn secondary" href="/admin/events">Events</a>` : ""}
    ${p.global ? `<a class="btn secondary" href="/admin/data">Data</a>` : ""}
    ${p.global ? `<a class="btn" href="/admin/brands/new">+ New ${lower(t.brandSingular)}</a>` : ""}`;
  const banner = actingClientName
    ? `<div class="stat" style="border:1px solid #2563eb;background:#eff6ff;margin-bottom:12px">Managing client <strong>${esc(
        actingClientName
      )}</strong> · <a href="/admin/clients/exit">← back to all clients</a></div>`
    : "";
  const verifyBanner =
    verifyState === "sent"
      ? `<div class="stat" style="border:1px solid #16a34a;background:#f0fdf4;margin-bottom:12px">Verification email sent — check your inbox.</div>`
      : verifyState === "needed"
      ? `<div class="stat" style="border:1px solid #d97706;background:#fffbeb;margin-bottom:12px">
      <strong>Verify your email to go live.</strong> Your ${esc(lower(t.cardPlural))} and lead capture stay private until you confirm the address you signed up with.
      <form method="POST" action="/admin/verify/resend" style="display:inline;margin-left:8px"><button class="btn secondary" type="submit" style="padding:4px 10px;font-size:13px">Resend verification email</button></form>
    </div>`
      : "";
  const ob = onboarding;
  const obStep = (done: boolean, label: string, href: string | null, hint: string) => `
    <li style="display:flex;align-items:baseline;gap:10px;padding:6px 0">
      <span style="font-size:15px">${done ? "✅" : "⬜️"}</span>
      <span>${done ? `<s class="muted">${label}</s>` : href ? `<a href="${esc(href)}"><strong>${label}</strong></a>` : `<strong>${label}</strong>`}
      ${done ? "" : `<span class="muted"> — ${hint}</span>`}</span>
    </li>`;
  const obPanel = ob
    ? (() => {
        const s = ob.steps;
        const doneCount = Object.values(s).filter(Boolean).length;
        const cardListHref = ob.firstCard ? `/admin/cards?locationId=${esc(ob.firstCard.locationId)}` : "/admin";
        return `
  <section class="panel" style="margin-bottom:14px;border:1px solid var(--accent, #1F5BEA)">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">
      <h3 style="margin:0">Getting started — ${doneCount} of 5 done</h3>
      <form method="POST" action="/admin/onboarding/dismiss"><button class="btn secondary" type="submit" style="padding:4px 10px;font-size:12px">Dismiss</button></form>
    </div>
    <ul style="list-style:none;margin:10px 0 0;padding:0">
      ${obStep(s.brand, `Create your first ${esc(lower(t.brandSingular))}`, "/admin/brands/new", "the umbrella your locations live under")}
      ${obStep(s.location, `Add a ${esc(lower(t.locationSingular))}`, s.brand ? `/admin/locations/new${ob.firstBrandId ? `?brandId=${esc(ob.firstBrandId)}` : ""}` : null, s.brand ? "where your people work" : `needs a ${esc(lower(t.brandSingular))} first`)}
      ${obStep(s.card, `Make your first ${esc(lower(t.cardSingular))}`, s.location ? cardListHref : null, s.location ? "or import your whole team from Azure or a spreadsheet" : `needs a ${esc(lower(t.locationSingular))} first`)}
      ${obStep(s.shared, `Share it`, ob.firstCard ? `/c/${esc(ob.firstCard.slug)}` : null, `open the public page, or print the QR — counts once it gets a view`)}
      ${obStep(s.lead, `Capture your first lead`, s.card ? "/admin/leads" : null, `the contact form on every ${esc(lower(t.cardSingular))} feeds your leads inbox`)}
    </ul>
  </section>`;
      })()
    : "";
  const body = `
  ${banner}
  ${verifyBanner}
  ${obPanel}
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>${esc(t.brandPlural)} &amp; ${esc(lower(t.locationPlural))}</h2>
      <p class="muted" style="margin:0">Signed in as ${esc(p.name)} · <strong>${esc(ROLE_LABELS[p.role])}</strong></p>
    </div>
    <div>${topActions}</div>
  </div>
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

// Format a Date/ISO string for a <input type="datetime-local"> value (UTC-based
// "YYYY-MM-DDTHH:mm"), or "" when empty.
function dtLocal(v: Date | string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16);
}

export function brandForm(
  brand?: any,
  stats?: { locations: number; cards: number },
  t: Terminology = GENERAL_TERMINOLOGY
): string {
  const b = brand || {};
  const action = brand ? `/admin/brands/${brand.id}` : "/admin/brands";
  const brandDomains = (b.domains as any[]) || [];
  const adminDomain = brandDomains.find((d) => !d.locationId && d.kind === "admin")?.host || "";
  const userDomain = brandDomains.find((d) => !d.locationId && d.kind !== "admin")?.host || "";
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>${brand ? `Edit ${esc(lower(t.brandSingular))} — ${esc(b.name)}` : `New ${esc(lower(t.brandSingular))}`}</h2>
      <p class="muted" style="margin:0">Identity, design defaults, and policies every ${esc(lower(t.locationSingular))} and ${esc(lower(t.cardSingular))} inherits.</p>
    </div>
  </div>
  <form class="editor" method="POST" action="${action}" enctype="multipart/form-data">
    <h3>Identity</h3>
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
      fields: Array.isArray(b.leadFields) ? asStringArray(b.leadFields) : defaultLeadFieldsFor(t.vertical),
      consentText: b.leadConsentText,
      vertical: t.vertical,
      inheritName: "leadDefault",
      inheritLabel: "Use the built-in default lead form",
      inherit: b.leadFields == null,
    })}

    <h3 style="margin-top:16px">Signature campaign banner</h3>
    <p class="muted">A promo banner that appears in every rooftop's email signatures during the date window. Leave the text blank for no banner; leave a date blank for open-ended.</p>
    <label>Banner text</label>
    <input name="signatureBannerText" value="${esc(b.signatureBannerText)}" placeholder="Summer Sales Event — 0% APR for 60 months" />
    <label style="margin-top:8px">Link URL <span class="muted">(optional)</span></label>
    <input name="signatureBannerHref" value="${esc(b.signatureBannerHref)}" placeholder="https://acmeford.com/summer" />
    <div class="grid2">
      <div><label>Start <span class="muted">(optional)</span></label><input type="datetime-local" name="signatureBannerStart" value="${dtLocal(b.signatureBannerStart)}" /></div>
      <div><label>End <span class="muted">(optional)</span></label><input type="datetime-local" name="signatureBannerEnd" value="${dtLocal(b.signatureBannerEnd)}" /></div>
    </div>

    <h3 style="margin-top:16px">Branded login domains</h3>
    <p class="muted">Point hostnames at OpenCard (CNAME to <code>tenants.opencard.id</code>) for login pages with this brand's logo &amp; colors. Use separate hosts for the employee and admin portals — visiting each lands on the right sign-in. Rooftops can override. Leave blank for none.</p>
    <div class="grid2">
      <div><label>Employee login domain</label><input name="userDomain" value="${esc(userDomain)}" placeholder="cards.yourbrand.com" /></div>
      <div><label>Admin login domain</label><input name="adminDomain" value="${esc(adminDomain)}" placeholder="cardadmin.yourbrand.com" /></div>
    </div>

    <div class="form-actions"><button class="btn" type="submit">Save brand</button>
    <a class="btn secondary" href="/admin">Cancel</a></div>
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

// Events list + create (Phase 10.2).
export function eventsView(data: { events: any[]; locations: { id: string; name: string }[] }, t: Terminology = GENERAL_TERMINOLOGY): string {
  const pill = (ev: any) => {
    const s = eventStatus(ev);
    const cls = s === "live" ? "on" : s === "off" || s === "ended" ? "off" : "";
    return `<span class="pill ${cls}">${EVENT_STATUS_LABELS[s]}</span>`;
  };
  const day = (d: any) => (d ? esc(new Date(d).toISOString().slice(0, 10)) : "");
  const rows = data.events.length
    ? data.events
        .map(
          (ev) => `<tr>
        <td><a href="/admin/events/${esc(ev.id)}">${esc(ev.name)}</a></td>
        <td>${pill(ev)}</td>
        <td class="muted">${ev.location?.name ? esc(ev.location.name) : "—"}</td>
        <td class="muted">${day(ev.startsAt)}${ev.endsAt ? ` → ${day(ev.endsAt)}` : ""}</td>
        <td>${ev._count?.assets ?? 0} QR</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="muted">No events yet.</td></tr>`;
  const locOpts = `<option value="">(no ${lower(t.locationSingular)} — set later)</option>` + data.locations.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar"><h2>Events</h2></div>
  <p class="muted">${esc(packFor(t.vertical).eventsExamples)}: create an event, add QR codes that capture leads, and track its performance. Event QR codes only work while the event is live.</p>
  <table>
    <tr><th>Event</th><th>Status</th><th>${esc(t.locationSingular)}</th><th>Dates</th><th>QR</th></tr>
    ${rows}
  </table>
  <h3 style="margin-top:18px">New event</h3>
  <form class="editor" method="POST" action="/admin/events" style="max-width:560px">
    <label>Event name</label>
    <input name="name" placeholder="Summer Tent Sale" required />
    <label style="margin-top:8px">${esc(t.locationSingular)}</label>
    <select name="locationId">${locOpts}</select>
    <div class="grid2">
      <div><label style="margin-top:8px">Starts <span class="muted">(optional)</span></label><input type="datetime-local" name="startsAt" /></div>
      <div><label style="margin-top:8px">Ends <span class="muted">(optional)</span></label><input type="datetime-local" name="endsAt" /></div>
    </div>
    <p style="margin-top:10px"><button class="btn" type="submit">Create event</button></p>
  </form>`;
  return shell("Events", body);
}

// Event detail: edit, performance, QR assets, attach QR (Phase 10.2).
export function eventDetailView(data: { ev: any; scans: number; leads: number; baseUrl: string; locations: { id: string; name: string }[] }, t: Terminology = GENERAL_TERMINOLOGY): string {
  const ev = data.ev;
  const status = eventStatus(ev);
  const conv = data.scans ? Math.round((data.leads / data.scans) * 1000) / 10 : 0;
  const assetRows = ev.assets.length
    ? ev.assets
        .map(
          (a: any) => `<tr>
        <td>${esc(a.name)}</td>
        <td><a href="${esc(data.baseUrl)}/a/${esc(a.slug)}" target="_blank"><code>/a/${esc(a.slug)}</code></a></td>
        <td><a href="${esc(data.baseUrl)}/a/${esc(a.slug)}/qr.png" target="_blank">QR</a></td>
        <td>${a.scanCount}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No QR codes yet — add one below.</td></tr>`;
  const needsLoc = !ev.locationId;
  const locOpts = data.locations.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
  const body = `
  <p class="crumb"><a href="/admin/events">← Events</a></p>
  <div class="topbar"><h2>${esc(ev.name)} <span class="pill ${status === "live" ? "on" : "off"}">${EVENT_STATUS_LABELS[status]}</span></h2></div>
  <p class="muted">${ev.location?.name ? `${esc(t.locationSingular)}: ${esc(ev.location.name)} · ` : ""}Event QR codes resolve only while <strong>Live</strong>.</p>

  <div class="cards-grid">
    <div class="stat"><div class="n">${data.scans}</div><div class="muted">QR scans</div></div>
    <div class="stat"><div class="n">${data.leads}</div><div class="muted">Leads captured</div></div>
    <div class="stat"><div class="n">${conv}%</div><div class="muted">Scan → lead rate</div></div>
  </div>

  <h3 style="margin-top:24px">QR codes</h3>
  <table><tr><th>Name</th><th>Link</th><th>QR</th><th>Scans</th></tr>${assetRows}</table>
  <form class="editor" method="POST" action="/admin/events/${esc(ev.id)}/assets" style="max-width:560px;margin-top:10px">
    <label>Add a QR code — name</label>
    <input name="name" placeholder="Entrance banner" required />
    ${needsLoc ? `<label style="margin-top:8px">${esc(t.locationSingular)}</label><select name="locationId" required><option value="">(pick a ${lower(t.locationSingular)})</option>${locOpts}</select>` : ""}
    <p style="margin-top:10px"><button class="btn" type="submit">Add QR code</button></p>
  </form>

  <h3 style="margin-top:24px">Event settings</h3>
  <form class="editor" method="POST" action="/admin/events/${esc(ev.id)}" style="max-width:560px">
    <label>Name</label><input name="name" value="${esc(ev.name)}" required />
    <label class="chk" style="margin-top:8px"><input type="checkbox" name="active" value="1" ${ev.active ? "checked" : ""} /> Active</label>
    <div class="grid2">
      <div><label style="margin-top:8px">Starts</label><input type="datetime-local" name="startsAt" value="${dtLocal(ev.startsAt)}" /></div>
      <div><label style="margin-top:8px">Ends</label><input type="datetime-local" name="endsAt" value="${dtLocal(ev.endsAt)}" /></div>
    </div>
    <p style="margin-top:10px"><button class="btn" type="submit">Save event</button></p>
  </form>

  <div class="danger-zone" style="margin-top:20px;max-width:560px">
    <form method="POST" action="/admin/events/${esc(ev.id)}/delete" onsubmit="return confirm('Delete this event? Its QR codes are kept but detached.')">
      <button class="btn danger" type="submit">Delete event</button>
    </form>
  </div>`;
  return shell(ev.name, body);
}

// Data & privacy hub (Phase 9.2/9.3): export + erasure + retention controls.
export function dataPrivacyView(d: {
  orgName: string;
  canPurge: boolean;
  done: boolean;
  retentionDays?: number | null;
  pruned?: number | null;
}): string {
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar"><h2>Data &amp; privacy</h2></div>
  ${d.done ? `<p class="auth-banner" style="max-width:none">Data purge complete.</p>` : ""}
  ${d.pruned != null ? `<p class="auth-banner" style="max-width:none">Retention prune complete — ${d.pruned} lead(s) removed.</p>` : ""}

  <h3>Data retention</h3>
  <p class="muted">Automatically delete leads older than a set number of days (data minimization). Leave blank / 0 to keep leads indefinitely. Runs automatically and can be triggered on demand; each prune is recorded in the audit log.</p>
  <form class="editor" method="POST" action="/admin/data/retention" style="max-width:420px">
    <label>Delete leads older than (days)</label>
    <input name="leadRetentionDays" type="number" min="0" value="${d.retentionDays ?? ""}" placeholder="e.g. 365 (blank = keep forever)" />
    <p style="margin-top:10px"><button class="btn" type="submit">Save policy</button>
    <button class="btn secondary" type="submit" formaction="/admin/data/retention/prune">Run prune now</button></p>
  </form>

  <h3 style="margin-top:24px">Export</h3>`;
  const rest = `
  <p class="muted">Download a full JSON copy of this account's data (brands, rooftops, cards, employees, leads, assets, campaigns) — for data-portability / GDPR access requests. Secrets (tokens, Stripe IDs) are excluded.</p>
  <p><a class="btn" href="/admin/data/export.json">⬇ Download data (JSON)</a></p>
  <h3 style="margin-top:24px">Erase a lead</h3>
  <p class="muted">To honor a customer's right to erasure, open the lead from <a href="/admin/leads">Leads</a> and use <strong>Erase lead</strong>. Every erasure is recorded in the <a href="/admin/audit">audit log</a>.</p>
  ${
    d.canPurge
      ? `<div class="danger-zone">
    <h3>Danger zone — erase ALL data for ${esc(d.orgName)}</h3>
    <p class="muted">Permanently deletes every brand, rooftop, card, employee, lead, asset, campaign, and integration for this client. The account shell and admin logins remain. This cannot be undone.</p>
    <form method="POST" action="/admin/data/purge" onsubmit="return confirm('Permanently erase ALL data for ${esc(d.orgName)}? This cannot be undone.')">
      <label>Type the client name to confirm: <strong>${esc(d.orgName)}</strong></label>
      <input name="confirmName" autocomplete="off" placeholder="${esc(d.orgName)}" />
      <button class="btn danger" type="submit">Erase all data</button>
    </form>
  </div>`
      : ""
  }`;
  return shell("Data & privacy", body + rest);
}

// Append-only audit trail viewer (Phase 9.1).
export function auditView(logs: any[], action: string | null = null): string {
  const rows = logs.length
    ? logs
        .map((l) => {
          const when = new Date(l.createdAt).toISOString().slice(0, 16).replace("T", " ");
          return `<tr>
        <td class="muted" style="white-space:nowrap">${esc(when)}</td>
        <td>${esc(formatAuditActor(l.actorEmail, l.actorRole))}</td>
        <td>${esc(auditLabel(l.action))} <span class="muted" style="font-size:11px">${esc(l.action)}</span></td>
        <td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(l.summary || l.targetType || "")}</td>
        <td class="muted" style="font-size:12px">${esc(l.ip || "")}</td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="muted">No audit entries${action ? " for this action" : ""} yet.</td></tr>`;
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar"><h2>Audit log</h2></div>
  <p class="muted">Security &amp; compliance trail of admin, sign-in, integration, SSO/SCIM, billing, and domain changes. Newest first (last 250).${
    action ? ` Filtered to <code>${esc(action)}</code> · <a href="/admin/audit">clear</a>` : ""
  }</p>
  <table>
    <tr><th>When (UTC)</th><th>Actor</th><th>Action</th><th>Details</th><th>IP</th></tr>
    ${rows}
  </table>`;
  return shell("Audit log", body);
}

// Marketing: per-org GA4/GTM tags injected into public pages + trackable
// campaign short links.
export function marketingView(data: { org: any; campaigns: any[]; baseUrl: string }): string {
  const org = data.org || {};
  const rows = (data.campaigns || []).length
    ? data.campaigns
        .map((c) => {
          const shortUrl = `${data.baseUrl}/k/${esc(c.code)}`;
          const utm = [c.utmSource && `source=${c.utmSource}`, c.utmMedium && `medium=${c.utmMedium}`, c.utmCampaign && `campaign=${c.utmCampaign}`]
            .filter(Boolean)
            .join(" · ");
          return `<tr>
        <td><a href="${shortUrl}" target="_blank"><code>/k/${esc(c.code)}</code></a></td>
        <td>${esc(c.name)}</td>
        <td class="muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis"><code>${esc(c.landingUrl)}</code></td>
        <td class="muted" style="font-size:12px">${esc(utm || "—")}</td>
        <td>${c.clicks}</td>
        <td><form method="POST" action="/admin/marketing/campaigns/${esc(c.id)}/delete" onsubmit="return confirm('Delete this campaign link?')"><button class="btn danger" type="submit">Delete</button></form></td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="muted">No campaign links yet.</td></tr>`;
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>Marketing</h2>
      <p class="muted" style="margin:0">Your analytics tags on public pages, and trackable campaign short links.</p>
    </div>
  </div>

  <section class="panel">
  <h3>Analytics tags</h3>
  <p class="muted">Injected into this account's public card and QR-landing pages, so scans and views land in your own Google Analytics / Tag Manager.</p>
  <form class="editor" method="POST" action="/admin/marketing/tags">
    <div class="grid2">
      <div><label>GA4 Measurement ID</label><input name="gaMeasurementId" value="${esc(org.gaMeasurementId || "")}" placeholder="G-XXXXXXXXXX" /></div>
      <div><label>Google Tag Manager container ID</label><input name="gtmContainerId" value="${esc(org.gtmContainerId || "")}" placeholder="GTM-XXXXXXX" /></div>
    </div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Leave blank to disable. Invalid IDs are ignored.</p>
    <p style="margin-top:10px"><button class="btn" type="submit">Save tags</button></p>
  </form>
  </section>

  <section class="panel">
  <h3>Campaign links</h3>
  <p class="muted">Short, trackable links that redirect to a landing page with UTM parameters attached — great for print QR codes, ads, and events.</p>
  <table>
    <tr><th>Short link</th><th>Name</th><th>Landing</th><th>UTM</th><th>Clicks</th><th></th></tr>
    ${rows}
  </table>
  <form class="editor" method="POST" action="/admin/marketing/campaigns">
    <div class="grid2">
      <div><label>Campaign name</label><input name="name" placeholder="Summer Sales Event" required /></div>
      <div><label>Short code <span class="muted">(optional)</span></label><input name="code" placeholder="summer" /></div>
    </div>
    <label>Landing URL</label>
    <input name="landingUrl" type="url" placeholder="https://dealer.com/specials" required />
    <div class="grid2">
      <div><label>UTM source</label><input name="utmSource" placeholder="qr" /></div>
      <div><label>UTM medium</label><input name="utmMedium" placeholder="print" /></div>
    </div>
    <label>UTM campaign <span class="muted">(defaults to the short code)</span></label>
    <input name="utmCampaign" placeholder="summer-2026" />
    <p style="margin-top:10px"><button class="btn" type="submit">Add campaign link</button></p>
  </form>
  </section>`;
  return shell("Marketing", body);
}

// Self-serve custom-domain onboarding hub: list domains with copy-paste DNS
// instructions + one-click Verify, plus an add form. Available to brand admins.
export function domainsView(data: { domains: any[]; brands: any[]; target: string; flash: string | null }): string {
  const { domains, brands, target } = data;
  const badge = (d: any) =>
    d.verifyState === "verified"
      ? `<span class="pill on">✓ Verified</span>`
      : d.verifyState === "pending"
      ? `<span class="pill off">Awaiting DNS</span>`
      : `<span class="pill">Not checked yet</span>`;
  const rows = domains.length
    ? domains
        .map((d) => {
          const purpose = d.kind === "admin" ? "Admin sign-in" : "Employee sign-in";
          const scope = d.location ? esc(d.location.name) : esc(d.brand?.name || "");
          return `<div class="item-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div><strong>${esc(d.host)}</strong> ${badge(d)}<br><span class="muted">${purpose} · ${scope}</span></div>
        <div>
          <form method="POST" action="/admin/domains/${esc(d.id)}/verify" style="display:inline"><button class="btn secondary" type="submit">Verify</button></form>
          <form method="POST" action="/admin/domains/${esc(d.id)}/delete" style="display:inline" onsubmit="return confirm('Remove ${esc(d.host)}?')"><button class="btn danger" type="submit">Remove</button></form>
        </div>
      </div>
      <p class="muted" style="margin:10px 0 4px">At your domain provider, add this DNS record:</p>
      <table class="usage" style="max-width:none"><tbody>
        <tr><td style="width:120px">Type</td><td><code>CNAME</code></td></tr>
        <tr><td>Name / Host</td><td><code>${esc(d.host)}</code></td></tr>
        <tr><td>Value / Target</td><td><code>${esc(target)}</code></td></tr>
        <tr><td>Proxy (Cloudflare)</td><td><strong>DNS only</strong> — grey cloud, not proxied</td></tr>
      </tbody></table></div>`;
        })
        .join("")
    : `<p class="muted">No custom domains yet — add one below.</p>`;
  const scopeOptions = brands
    .map((b) => {
      const locs = (b.locations || [])
        .map((l: any) => `<option value="location:${esc(l.id)}">${esc(b.name)} — ${esc(l.name)}</option>`)
        .join("");
      return `<option value="brand:${esc(b.id)}">${esc(b.name)} (whole brand)</option>${locs}`;
    })
    .join("");
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar"><h2>Custom domains</h2></div>
  <p class="muted">Give your sign-in pages your own web address (e.g. <code>cards.yourco.com</code>). Add the domain, create the one DNS record shown, then click <strong>Verify</strong> — the secure certificate is set up automatically once DNS points to us.</p>
  <p style="border-left:4px solid #d97706;background:#fffbeb;color:#7c2d12;padding:10px 12px;border-radius:6px;font-size:14px;max-width:none">
    <strong>Using Cloudflare for your DNS?</strong> Set this record to <strong>DNS only</strong> (grey cloud) — <em>not</em> Proxied (orange cloud). A proxied record blocks our automatic certificate and the page will show an SSL error (525). You can switch it back to proxied only if you install your own Cloudflare Origin Certificate.
  </p>
  ${data.flash ? `<p class="auth-banner" style="max-width:none">${esc(data.flash)}</p>` : ""}
  ${rows}
  <h3 style="margin-top:18px">Add a domain</h3>
  <form class="editor" method="POST" action="/admin/domains" style="max-width:560px">
    <label>Hostname</label>
    <input name="host" placeholder="cards.yourco.com" required />
    <label style="margin-top:8px">Which sign-in?</label>
    <select name="kind"><option value="user">Employee sign-in</option><option value="admin">Admin sign-in</option></select>
    <label style="margin-top:8px">Applies to</label>
    <select name="scope">${scopeOptions || `<option value="">(no brands available)</option>`}</select>
    <p style="margin-top:12px"><button class="btn" type="submit">Add domain</button></p>
  </form>`;
  return shell("Custom domains", body);
}

// Schematic thumbnails for each email-signature theme (mirrors card layout thumbs).
const SIGNATURE_THEME_THUMBS: Record<SignatureTheme, string> = {
  classic: `<svg viewBox="0 0 60 40"><rect x="4" y="8" width="14" height="14" rx="2" fill="currentColor" opacity="0.25"/><rect x="22" y="8" width="2" height="20" fill="currentColor"/><rect x="27" y="9" width="26" height="3" rx="1.5" fill="#334155"/><rect x="27" y="15" width="20" height="2" rx="1" fill="currentColor"/><rect x="27" y="20" width="24" height="2" rx="1" fill="#cbd5e1"/><rect x="27" y="24" width="16" height="2" rx="1" fill="#cbd5e1"/></svg>`,
  compact: `<svg viewBox="0 0 60 40"><rect x="6" y="14" width="30" height="3" rx="1.5" fill="#334155"/><rect x="40" y="14" width="14" height="3" rx="1.5" fill="currentColor"/><rect x="6" y="21" width="20" height="2" rx="1" fill="#cbd5e1"/><rect x="30" y="21" width="24" height="2" rx="1" fill="#cbd5e1"/></svg>`,
  modern: `<svg viewBox="0 0 60 40"><rect x="4" y="6" width="52" height="10" rx="2" fill="currentColor"/><rect x="8" y="9" width="24" height="4" rx="2" fill="#fff"/><rect x="4" y="18" width="52" height="16" rx="2" fill="currentColor" opacity="0.12"/><rect x="8" y="22" width="20" height="2" rx="1" fill="#64748b"/><rect x="8" y="27" width="30" height="4" rx="2" fill="currentColor"/></svg>`,
  minimal: `<svg viewBox="0 0 60 40"><rect x="8" y="9" width="24" height="3" rx="1.5" fill="#334155"/><rect x="8" y="15" width="18" height="2" rx="1" fill="#94a3b8"/><rect x="8" y="20" width="30" height="2" rx="1" fill="#94a3b8"/><rect x="8" y="25" width="22" height="2" rx="1" fill="currentColor"/></svg>`,
};

// Per-rooftop email-signature design + governance controls, with a live preview
// iframe (like the card design editor). Only meaningful for a saved rooftop.
function signatureDesignSection(l: any): string {
  if (!l || !l.id) {
    return `<h3>Email signature design</h3>
    <p class="muted">Save this rooftop first, then reopen it to choose a signature theme, set a disclaimer, and lock elements.</p>`;
  }
  const theme = (SIGNATURE_THEMES.some(([k]) => k === l.signatureTheme) ? l.signatureTheme : "classic") as SignatureTheme;
  const primary = l.primaryColor || "#1f6f43";
  const locks = new Set(asLockList(l.signatureLocks));
  const disclaimer = l.signatureDisclaimer || "";
  const previewSrc = (th: string) =>
    `/preview/signature?theme=${encodeURIComponent(th)}&primary=${encodeURIComponent(primary)}` +
    (l.logoUrl ? `&logo=${encodeURIComponent(l.logoUrl)}` : "") +
    (disclaimer ? `&disclaimer=${encodeURIComponent(disclaimer)}` : "");
  const thumbs = SIGNATURE_THEMES.map(
    ([k, label]) => `<label class="layout-thumb ${k === theme ? "sel" : ""}">
      <input type="radio" name="signatureTheme" value="${k}" ${k === theme ? "checked" : ""} />
      ${SIGNATURE_THEME_THUMBS[k]}<span>${esc(label)}</span></label>`
  ).join("");
  const lockBoxes = SIGNATURE_ELEMENTS.map(
    ([k, label]) => `<label class="chk"><input type="checkbox" name="signatureLocks" value="${k}" ${
      locks.has(k) ? "checked" : ""
    } /> ${esc(label)}</label>`
  ).join("");
  return `
    <h3>Email signature design</h3>
    <p class="muted">Choose how this rooftop's employee email signatures look. Applies to every card at this ${esc(
      "rooftop"
    )}.</p>
    <div class="sig-design" data-primary="${esc(primary)}"${l.logoUrl ? ` data-logo="${esc(l.logoUrl)}"` : ""}>
      <div class="layout-thumbs">${thumbs}</div>
      <div class="design-preview-wrap" style="margin-top:10px">
        <iframe id="sig-preview" src="${esc(previewSrc(theme))}" title="Signature preview"
          style="width:100%;min-height:150px;border:1px solid #e5e7eb;border-radius:8px;background:#fff"></iframe>
        <p class="muted">Live preview with sample data — updates as you pick a theme.</p>
      </div>
    </div>
    <label style="margin-top:8px">Rooftop disclaimer <span class="muted">(overrides the template disclaimer for this rooftop's signatures)</span></label>
    <textarea id="sig-disclaimer" name="signatureDisclaimer" rows="2" placeholder="Prices exclude tax, title, and license.">${esc(
      disclaimer
    )}</textarea>
    <label style="margin-top:8px">Locked elements <span class="muted">(employees can't remove these from their signature)</span></label>
    <div class="self-fields">${lockBoxes}</div>
    <script>(function(){
      var wrap=document.querySelector('.sig-design'); if(!wrap) return;
      var iframe=document.getElementById('sig-preview');
      var disc=document.getElementById('sig-disclaimer');
      var primary=wrap.getAttribute('data-primary')||'#1f6f43';
      var logo=wrap.getAttribute('data-logo')||'';
      function refresh(){
        var r=wrap.querySelector('input[name=signatureTheme]:checked');
        var th=r?r.value:'classic';
        var u='/preview/signature?theme='+encodeURIComponent(th)+'&primary='+encodeURIComponent(primary);
        if(logo) u+='&logo='+encodeURIComponent(logo);
        if(disc && disc.value) u+='&disclaimer='+encodeURIComponent(disc.value.slice(0,400));
        iframe.src=u;
      }
      wrap.querySelectorAll('input[name=signatureTheme]').forEach(function(el){
        el.addEventListener('change', function(){
          wrap.querySelectorAll('.layout-thumb').forEach(function(t){t.classList.remove('sel');});
          el.closest('.layout-thumb').classList.add('sel');
          refresh();
        });
      });
      if(disc){ var tmr; disc.addEventListener('input', function(){ clearTimeout(tmr); tmr=setTimeout(refresh,400); }); }
    })();</script>`;
}

export function locationForm(
  brandId: string,
  location?: any,
  t: Terminology = GENERAL_TERMINOLOGY
): string {
  const l = location || {};
  const addr = (l.address as Address) || {};
  const action = location ? `/admin/locations/${location.id}` : "/admin/locations";
  const locDomains = (l.domains as any[]) || [];
  const locAdminDomain = locDomains.find((d) => d.locationId && d.kind === "admin")?.host || "";
  const locUserDomain = locDomains.find((d) => d.locationId && d.kind !== "admin")?.host || "";
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>${location ? `Edit ${esc(lower(t.locationSingular))} — ${esc(l.name)}` : `New ${esc(lower(t.locationSingular))}`}</h2>
      <p class="muted" style="margin:0">Profile, lead routing, and design overrides for this ${esc(lower(t.locationSingular))}.</p>
    </div>
    ${location ? `<div>
      <a class="btn secondary" href="/admin/locations/${esc(location.id)}/departments">Departments</a>
      <a class="btn secondary" href="/admin/locations/${esc(location.id)}/assets">Assets</a>
      <a class="btn secondary" href="/admin/cards?locationId=${esc(location.id)}">${esc(t.cardPlural)}</a>
    </div>` : ""}
  </div>
  <form class="editor" method="POST" action="${action}" enctype="multipart/form-data">
    <input type="hidden" name="brandId" value="${esc(brandId)}" />
    <h3>Basics</h3>
    <div class="grid2">
      <div><label>${esc(t.locationSingular)} name</label><input name="name" value="${esc(l.name)}" required /></div>
      <div><label>${esc(t.locationCodeLabel)} <span class="muted">(directory mapping)</span></label><input name="code" value="${esc(l.code)}" placeholder="e.g. STORE-014" /></div>
    </div>
    <h3>Design overrides</h3>
    <p class="muted">Leave anything blank to inherit from the ${esc(lower(t.brandSingular))}.</p>
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
    <label class="chk" style="margin-top:12px"><input type="checkbox" name="showFooter" value="1" ${
      l.hideCardFooter ? "" : "checked"
    } /> Show the "${esc(t.brandSingular)} · ${esc(t.locationSingular)}" footer on ${esc(lower(t.cardPlural))} and landing pages</label>
    <label class="chk"><input type="checkbox" name="showDealerHeader" value="1" ${
      l.hideDealerHeader ? "" : "checked"
    } /> Show the ${esc(lower(t.locationSingular))} name and franchise badges above the action buttons on ${esc(lower(t.cardPlural))}</label>
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

    ${(() => {
      const vp = packFor(t.vertical);
      return `<h3>${esc(vp.locationEditor.heading)}</h3>
    <p class="muted">${esc(vp.locationEditor.blurb)}</p>
    ${
      vp.locationEditor.showOemBrands
        ? `<label>OEM brands <span class="muted">(comma-separated)</span></label>
    <input name="oemBrands" list="oem-list" value="${esc(parseOemBrands(l.oemBrands).join(", "))}" placeholder="e.g. Ford, Lincoln" />
    <datalist id="oem-list">${KNOWN_OEMS.map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>`
        : ""
    }`;
    })()}
    <div class="grid2">
      <div><label>Main phone</label><input name="phone" value="${esc(l.phone)}" placeholder="(555) 123-4567" /></div>
      <div><label>Website</label><input name="website" value="${esc(l.website)}" placeholder="acme.com" /></div>
    </div>
    ${(() => {
      const le = packFor(t.vertical).locationEditor;
      return le.showSalesServiceUrls
        ? `<div class="grid2">
      <div><label>${esc(le.salesUrlLabel || "Sales URL")}</label><input name="salesUrl" value="${esc(l.salesUrl)}" placeholder="${esc(le.salesUrlPlaceholder || "acmeford.com/inventory")}" /></div>
      <div><label>${esc(le.serviceUrlLabel || "Service URL")}</label><input name="serviceUrl" value="${esc(l.serviceUrl)}" placeholder="${esc(le.serviceUrlPlaceholder || "acmeford.com/service")}" /></div>
    </div>`
        : "";
    })()}
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

    ${signatureDesignSection(l)}

    ${
      l.id
        ? `<h3>Branded login domains (this ${esc(lower(t.locationSingular))})</h3>
    <p class="muted">Overrides the brand's domains for this rooftop — its own hostnames, logo &amp; colors (CNAME to <code>tenants.opencard.id</code>). Leave blank to use the brand's.</p>
    <div class="grid2">
      <div><label>Employee login domain</label><input name="userDomain" value="${esc(locUserDomain)}" placeholder="cards.thisrooftop.com" /></div>
      <div><label>Admin login domain</label><input name="adminDomain" value="${esc(locAdminDomain)}" placeholder="cardadmin.thisrooftop.com" /></div>
    </div>`
        : ""
    }

    <div class="form-actions"><button class="btn" type="submit">Save ${esc(lower(t.locationSingular))}</button>
    <a class="btn secondary" href="/admin">Cancel</a></div>
  </form>`;
  return shell(t.locationSingular, body);
}

// Manage the departments (and their CTAs) within a rooftop.
export function departmentsView(data: { location: any; departments: any[] }, t: Terminology = GENERAL_TERMINOLOGY): string {
  const loc = data.location;
  const existing = new Set(data.departments.map((d) => d.name));
  const suggestions = packFor(t.vertical).departments.filter((d) => !existing.has(d));
  const rows = data.departments.length
    ? data.departments
        .map(
          (d) => `<form class="editor item-card" method="POST" action="/admin/locations/${esc(loc.id)}/departments">
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
  <p class="crumb"><a href="/admin/locations/${esc(loc.id)}/edit">← Back to ${esc(loc.name)}</a></p>
  <h2>Departments — ${esc(loc.name)}</h2>
  <p class="muted">Each department can carry its own CTA buttons, which take precedence over the ${esc(lower(t.locationSingular))}'s on cards assigned to it.</p>
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
    <a class="btn secondary" href="/admin/locations/${esc(loc.id)}/edit">Cancel</a></p>
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
          return `<form class="editor item-card" method="POST" action="/admin/locations/${esc(loc.id)}/assets">
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
  <p class="crumb"><a href="/admin/locations/${esc(loc.id)}/edit">← Back to ${esc(loc.name)}</a></p>
  <h2>Assets — ${esc(loc.name)}</h2>
  <p class="muted">QR/NFC codes that aren't people: landing pages for the business or a department, and trackable event / campaign codes. Scans are counted.</p>
  ${rows}
  <h3 style="margin-top:20px">Add an asset</h3>
  <form class="editor" method="POST" action="/admin/locations/${esc(loc.id)}/assets" style="max-width:620px">
    <div class="grid2">
      <div><label>Type</label><select name="type">${typeOpts("campaign")}</select></div>
      <div><label>Name</label><input name="name" placeholder="e.g. Summer Sales Event" required /></div>
    </div>
    ${destFields({ destinationType: "landing", destinationUrl: "", destinationCardId: "" })}
    <p style="margin-top:10px"><button class="btn" type="submit">Add asset</button>
    <a class="btn secondary" href="/admin/locations/${esc(loc.id)}/edit">Cancel</a></p>
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
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <h2>${esc(t.cardPlural)} — ${esc(locationName)}</h2>
    <a class="btn" href="/admin/cards/new?locationId=${esc(locationId)}">+ New ${esc(lower(t.cardSingular))}</a>
  </div>
  <table class="rsp">
    <tr><th>Name</th><th>Title</th><th>Public link</th><th>Status</th><th></th></tr>
    ${
      cards.length
        ? cards
            .map(
              (c) => `<tr>
      <td>${esc([c.prefix, c.firstName, c.lastName].filter(Boolean).join(" "))}</td>
      <td data-label="Title" class="muted">${esc(c.title || "")}</td>
      <td data-label="Link"><a href="/c/${esc(c.slug)}" target="_blank">/c/${esc(c.slug)}</a></td>
      <td data-label="Status"><span class="pill ${c.active ? "on" : "off"}">${c.active ? "active" : "off"}</span></td>
      <td class="rsp-actions">
        <a href="/admin/cards/${esc(c.id)}/edit">Edit</a> ·
        <a href="/admin/cards/${esc(c.id)}/analytics">Stats</a> ·
        <a href="/c/${esc(c.slug)}/qr.png" target="_blank">QR</a>
      </td></tr>`
            )
            .join("")
        : `<tr><td colspan="5" class="muted">No ${esc(lower(t.cardPlural))} in this ${esc(lower(t.locationSingular))} yet.</td></tr>`
    }
  </table>`;
  return shell(t.cardPlural, body);
}

export function cardForm(opts: {
  card?: any;
  locationId: string;
  templates: any[];
  departments?: any[];
  brandSelfFields?: string[];
  terminology?: Terminology;
  baseDesign?: { layout: string; primary: string; text: string; bg: string; font: string; logo: string };
}): string {
  const t = opts.terminology || GENERAL_TERMINOLOGY;
  const c = opts.card || {};
  const cardOverride = Array.isArray(c.selfEditFields) ? (c.selfEditFields as string[]) : null;
  const inheritSelf = !cardOverride;
  const effectiveSelf = cardOverride || opts.brandSelfFields || DEFAULT_SELF_FIELDS;
  const action = opts.card ? `/admin/cards/${opts.card.id}` : "/admin/cards";
  const addr = (c.address as Address) || {};
  const cardName = [c.firstName, c.lastName].filter(Boolean).join(" ");
  const body = `
  <p class="crumb"><a href="/admin/cards?locationId=${esc(opts.locationId)}">← Back to ${esc(lower(t.cardPlural))}</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>${opts.card ? `Edit ${esc(lower(t.cardSingular))} — ${esc(cardName)}` : `New ${esc(lower(t.cardSingular))}`}</h2>
      <p class="muted" style="margin:0">Identity, contact details, design and self-service policy for this ${esc(lower(t.cardSingular))}.</p>
    </div>
    ${opts.card ? `<div>
      <a class="btn secondary" href="/c/${esc(opts.card.slug)}" target="_blank">Preview</a>
      <a class="btn secondary" href="/admin/cards/${esc(opts.card.id)}/analytics">Stats</a>
      <a class="btn secondary" href="/admin/cards/${esc(opts.card.id)}/signature">Email signature</a>
      <a class="btn secondary" href="/admin/cards/${esc(opts.card.id)}/idcard.pdf" title="Credit-card-sized PDF for badge printers (Datacard, Fargo, Zebra)">ID card PDF</a>
      <a class="btn secondary" href="/admin/cards/${esc(opts.card.id)}/idcard.pdf?orientation=portrait" title="Vertical badge layout">ID card (vertical)</a>
      <a class="btn secondary" href="/admin/cards/${esc(opts.card.id)}/turnover">Deprovision</a>
    </div>` : ""}
  </div>
  <div class="card-editor-flex">
  <form class="editor" method="POST" action="${action}" enctype="multipart/form-data" style="flex:1;min-width:0">
    <input type="hidden" name="locationId" value="${esc(opts.locationId)}" />
    <h3>Person</h3>
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
        <input type="radio" name="templateId" value="${esc(t.id)}" ${c.templateId === t.id ? "checked" : ""}
          data-layout="${esc(t.layout || "classic")}" data-primary="${esc(t.primaryColor || "")}" data-text="${esc(t.textColor || "")}" data-bg="${esc(t.bgColor || "")}" data-font="${esc(t.font || "system")}" />
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

    <div class="form-actions">
      <button class="btn" type="submit">Save ${esc(lower(t.cardSingular))}</button>
      <a class="btn secondary" href="/admin/cards?locationId=${esc(opts.locationId)}">Cancel</a>
    </div>
  </form>
  <aside class="card-live-rail" id="card-live-rail" data-base="${esc(JSON.stringify(opts.baseDesign || {}))}">
    <div class="device"><iframe id="card-live-preview" title="Live card preview"></iframe></div>
    <p class="muted" style="text-align:center;margin-top:8px">Live preview — updates as you type</p>
  </aside>
  </div>
  ${
    opts.card
      ? `<div class="danger-zone">
    <h3>Delete this ${esc(lower(t.cardSingular))}</h3>
    <p class="muted">Removes the public page and its analytics. For offboarding a person (redirects, lead transfer, replacement), use <a href="/admin/cards/${esc(opts.card.id)}/turnover">Deprovision</a> instead.</p>
    <form method="POST" action="/admin/cards/${esc(opts.card.id)}/delete"
           onsubmit="return confirm('Delete this ${esc(lower(t.cardSingular))}?')">
           <button class="btn danger" type="submit">Delete ${esc(lower(t.cardSingular))}</button></form>
  </div>`
      : ""
  }
  ${editorScripts()}
  <script>${cardLivePreviewScript()}</script>`;
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
  <p class="crumb"><a href="/admin/cards/${esc(c.id)}/edit">← Back to card</a></p>
  <h2>Deprovision — ${esc(fullName)}</h2>
  <p class="muted">Deprovisioning disables the public card, revokes this person's self-service access, and preserves their analytics. Leads stay unless you transfer them.</p>
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
      <button class="btn danger" type="submit" onclick="return confirm('Deprovision ${esc(fullName)}? The public card will be disabled.')">Deprovision employee</button>
      <a class="btn secondary" href="/admin/cards/${esc(c.id)}/edit">Cancel</a>
    </p>
  </form>`;
  return shell("Deprovision", body);
}

// One-time display of freshly generated MFA recovery codes.
export function recoveryCodesView(codes: string[], lede: string): string {
  const body = `
  <p class="crumb"><a href="/admin/security">← Security</a></p>
  <h2>Recovery codes</h2>
  <p class="muted" style="max-width:560px">${esc(lede)} Each code works once, in place of an authenticator code.</p>
  <div class="stat" style="max-width:560px">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;font-variant-numeric:tabular-nums">
      ${codes.map((c) => `<code style="text-align:center;padding:8px 6px;font-size:15px">${esc(c)}</code>`).join("")}
    </div>
    <p class="muted" style="margin:14px 0 0">Store them in a password manager. Anyone with a code can pass your two-factor prompt.</p>
  </div>
  <p style="margin-top:14px"><a class="btn" href="/admin/security">I've saved them</a></p>`;
  return shell("Recovery codes", body);
}

type SessionRow = { id: string; current: boolean; lastSeenAt: Date; createdAt: Date; ip: string | null; userAgent: string | null };

// Security (two-factor) settings, in the standard admin layout. `workspace`
// says whose account this is (an org name, or "OpenCard staff") so the page
// reads differently for client admins vs platform staff.
export function securityView(opts: {
  email: string | null;
  on: boolean;
  note?: string;
  workspace?: string | null;
  platform?: boolean;
  recoveryCount?: number;
  sessions?: SessionRow[];
}): string {
  const who = opts.platform
    ? `your <strong>OpenCard staff</strong> account`
    : opts.workspace
    ? `your admin account in <strong>${esc(opts.workspace)}</strong>`
    : `your admin account`;
  const inner = !opts.email
    ? `<p class="muted">You're signed in with the break-glass token, which has no stored account. Two-factor applies to email/password admin accounts.</p>`
    : opts.on
    ? `<p>Two-factor authentication is <strong>on</strong> for ${esc(opts.email)}.</p>
       <form method="POST" action="/admin/security/mfa/disable" style="margin-top:8px"><button class="btn danger" type="submit">Turn off two-factor</button></form>`
    : `<p>Two-factor authentication is <strong>off</strong>. Add an authenticator app for an extra layer of protection.</p>
       <form method="POST" action="/admin/security/mfa/start" style="margin-top:8px"><button class="btn" type="submit">Set up two-factor</button></form>`;
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>Security</h2>
      <p class="muted" style="margin:0">Sign-in protection for ${who}${opts.email ? ` (${esc(opts.email)})` : ""}. It doesn't affect anyone else.</p>
    </div>
  </div>
  ${opts.note || ""}
  <div class="stat" style="max-width:560px">${inner}</div>
  ${
    opts.on
      ? `<h3 style="margin-top:24px">Recovery codes</h3>
  <div class="stat" style="max-width:560px">
    <p style="margin:0 0 8px">${
      (opts.recoveryCount ?? 0) > 0
        ? `<strong>${opts.recoveryCount}</strong> unused recovery code${opts.recoveryCount === 1 ? "" : "s"} remaining.`
        : `No recovery codes left — generate new ones now, or a lost phone locks you out.`
    }</p>
    <form method="POST" action="/admin/security/recovery/regenerate" onsubmit="return confirm('Generate new recovery codes? Old codes stop working.')">
      <button class="btn secondary" type="submit">Generate new codes</button>
    </form>
  </div>`
      : ""
  }
  ${
    opts.sessions && opts.sessions.length
      ? `<h3 style="margin-top:24px">Active sessions</h3>
  <table style="max-width:720px">
    <tr><th>Session</th><th>Last active</th><th>IP</th><th></th></tr>
    ${opts.sessions
      .map(
        (s) => `<tr>
      <td>${s.current ? `<span class="pill on">this session</span>` : `<span class="muted" style="font-size:12px">${esc((s.userAgent || "unknown device").slice(0, 60))}</span>`}</td>
      <td class="muted">${esc(new Date(s.lastSeenAt).toISOString().slice(0, 16).replace("T", " "))}</td>
      <td class="muted">${esc(s.ip || "—")}</td>
      <td>${
        s.current
          ? ""
          : `<form method="POST" action="/admin/security/sessions/${esc(s.id)}/revoke"><button class="btn danger" type="submit">Sign out</button></form>`
      }</td>
    </tr>`
      )
      .join("")}
  </table>
  ${
    opts.sessions.length > 1
      ? `<form method="POST" action="/admin/security/sessions/revoke-others" style="margin-top:10px"><button class="btn secondary" type="submit">Sign out all other sessions</button></form>`
      : ""
  }
  <p class="muted" style="margin-top:8px;max-width:720px">Sessions from password sign-ins on this device list. SSO sign-ins (via /me) don't appear here and expire on their own.</p>`
      : ""
  }`;
  return shell("Security", body);
}

// Two-factor enrollment (QR + confirm), in the standard admin layout.
export function mfaSetupView(qr: string, secret: string, error?: string): string {
  const body = `
  <p class="crumb"><a href="/admin/security">← Security</a></p>
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
  <p class="crumb"><a href="/admin/cards/${esc(cardId)}/edit">← Back to card</a></p>
  <h2>Email signature — ${esc(fullName)}</h2>
  <p class="muted">A branded signature generated from this card. Paste it into Gmail / Outlook signature settings.</p>
  ${block}`
  );
}

const pq = (s: any) => encodeURIComponent(s || "");
function previewSrc(t: any): string {
  return `/preview/card?layout=${pq(t.layout)}&primary=${pq(t.primaryColor)}&text=${pq(
    t.textColor
  )}&bg=${pq(t.bgColor)}&font=${pq(t.font)}`;
}

export function templatesGallery(
  brandName: string,
  brandId: string,
  templates: any[],
  otherBrands: { id: string; name: string }[] = []
): string {
  const copyControl = (t: any) =>
    otherBrands.length
      ? ` &nbsp;·&nbsp; <form method="POST" action="/admin/templates/${esc(t.id)}/copy" style="display:inline">
        <select name="brandId" style="padding:3px 6px;font-size:12px">${otherBrands
          .map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`)
          .join("")}</select>
        <button class="btn secondary" type="submit" style="padding:3px 9px">Copy to</button></form>`
      : "";
  const cards = templates.length
    ? templates
        .map(
          (t) => `<div class="tpl-card">
        <div class="tpl-frame"><iframe src="${previewSrc(t)}" loading="lazy" title="${esc(t.name)}"></iframe></div>
        <div class="tpl-name">${esc(t.name)}${t.isDefault ? ` · <span class="muted">default</span>` : ""}</div>
        <p><a href="/admin/templates/${esc(t.id)}/edit">Edit</a>
        &nbsp;·&nbsp;
        <form method="POST" action="/admin/templates/${esc(t.id)}/duplicate" style="display:inline"><button class="btn secondary" type="submit" style="padding:3px 9px">Duplicate</button></form>
        ${copyControl(t)}
        &nbsp;·&nbsp;
        <form method="POST" action="/admin/templates/${esc(t.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this template? Cards using it fall back to the brand design.')"><button class="btn danger" type="submit" style="padding:3px 9px">Delete</button></form></p>
      </div>`
        )
        .join("")
    : `<p class="muted">No templates yet — start from the gallery below, or build one from scratch.</p>`;

  // Starter gallery: live previews of the shipped presets; one click prefills
  // the new-template form with that design.
  const starters = TEMPLATE_PRESETS.map(
    (pr) => `<div class="tpl-card">
      <div class="tpl-frame"><iframe src="/preview/card?layout=${esc(pr.layout)}&primary=${encodeURIComponent(
        pr.primaryColor
      )}&text=${encodeURIComponent(pr.textColor)}&bg=${encodeURIComponent(pr.bgColor)}&font=${esc(pr.font)}" loading="lazy" title="${esc(pr.name)}"></iframe></div>
      <div class="tpl-name">${esc(pr.name)}</div>
      <p class="muted" style="font-size:12px;margin:4px 0 8px">${esc(pr.description)}</p>
      <p><a class="btn secondary" style="padding:4px 12px" href="/admin/templates/new?brandId=${esc(brandId)}&preset=${esc(pr.key)}">Use this design</a></p>
    </div>`
  ).join("");

  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <h2>Templates — ${esc(brandName)}</h2>
    <a class="btn" href="/admin/templates/new?brandId=${esc(brandId)}">+ New template</a>
  </div>
  <p class="muted">A template fixes a layout, color theme and font once. Cards then just pick a template — no design fiddling per person.</p>
  <div class="tpl-grid">${cards}</div>
  <h3 style="margin-top:32px">Starter gallery</h3>
  <p class="muted">Ready-made designs — pick one as a starting point and tweak anything afterwards.</p>
  <div class="tpl-grid">${starters}</div>`;
  return shell("Templates", body);
}

export function templateForm(
  brandId: string,
  template?: any,
  term: Terminology = GENERAL_TERMINOLOGY,
  preset?: { name: string; layout: string; primaryColor: string; textColor: string; bgColor: string; font: string } | null
): string {
  // A preset prefills the CREATE form (name + design); it is not an edit.
  const t = template || (preset ? { ...preset } : {});
  const locked = new Set(asStringArray(t.lockedFields));
  const hidden = new Set(asStringArray(t.hiddenFields));
  const action = template ? `/admin/templates/${template.id}` : "/admin/templates";
  const body = `
  <p class="crumb"><a href="/admin/templates?brandId=${esc(brandId)}">← Templates</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>${template ? `Edit template — ${esc(t.name)}` : "New template"}</h2>
      <p class="muted" style="margin:0">A template fixes a design, role behavior and lead form once — cards just pick it.</p>
    </div>
  </div>
  <form class="editor" method="POST" action="${action}" style="max-width:900px">
    <input type="hidden" name="brandId" value="${esc(brandId)}" />
    <h3>Basics</h3>
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
    <datalist id="role-suggest">${packFor(term.vertical).roleSuggestions.map((r) => `<option value="${esc(r)}"></option>`).join("")}</datalist>

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
      fields: Array.isArray(t.leadFields) ? asStringArray(t.leadFields) : defaultLeadFieldsFor(term.vertical),
      consentText: t.leadConsentText,
      vertical: term.vertical,
      inheritName: "leadInherit",
      inheritLabel: "Inherit the lead form from the brand",
      inherit: t.leadFields == null,
    })}

    <div class="form-actions"><button class="btn" type="submit">Save template</button>
    <a class="btn secondary" href="/admin/templates?brandId=${esc(brandId)}">Cancel</a></div>
  </form>
  ${designScripts()}`;
  return shell("Template", body);
}

// Plan & usage: the client's own view of their plan, limits and usage. The
// hand-override controls render only for OpenCard staff and are labeled as such.
export function billingView(d: {
  plan: { key: string; label: string; price: string; features: string[] };
  modeLabel: string;
  statusLine: string;
  statusOk: boolean;
  usageRows: string; // pre-rendered <tr>s
  paySection: string;
  staffSetter: string | null; // pre-rendered staff-only form, or null
}): string {
  const feats = d.plan.features.length
    ? d.plan.features.map((f) => `<span class="pill">${esc(f)}</span>`).join(" ")
    : `<span class="muted">Basic features only</span>`;
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>Plan &amp; usage</h2>
      <p class="muted" style="margin:0">What your workspace's plan includes and how much of it you're using.</p>
    </div>
  </div>
  <div class="cards-grid" style="margin-bottom:18px;max-width:720px">
    <div class="stat"><div class="n" style="font-size:22px">${esc(d.plan.label)}</div><div class="muted">${esc(d.plan.price)} · ${esc(d.modeLabel)}</div></div>
    <div class="stat"><div style="font-weight:700;color:${d.statusOk ? "var(--ok-ink)" : "var(--bad-ink)"}">${esc(d.statusLine)}</div><div class="muted">Subscription status</div></div>
  </div>
  <section class="panel" style="max-width:720px">
    <h3>Usage against plan limits</h3>
    <table class="usage"><tbody>${d.usageRows}</tbody></table>
    <p style="margin-top:14px">Included: ${feats}</p>
  </section>
  <section class="panel" style="max-width:720px">
    <h3>Change plan</h3>
    ${d.paySection}
  </section>
  ${
    d.staffSetter
      ? `<section class="panel" style="max-width:720px;border-style:dashed">
    <h3>OpenCard staff controls</h3>
    <p class="muted">Only platform staff see this. Hand-assign a plan or billing mode (comp accounts, demos, manual overrides) — clients themselves can't change these.</p>
    ${d.staffSetter}
  </section>`
      : ""
  }`;
  return shell("Plan & usage", body);
}

// Directory import wizard (Phase 13): backfill employees from Azure AD.
// Self-service: the tenant connects their own Azure app registration here —
// no server configuration involved.
export function importView(d: {
  configured: boolean;
  t: Terminology;
  config?: { tenantId: string; clientId: string; source: "org" } | null;
  showSettings?: boolean;
  testResult?: string | null;
  groups?: { id: string; displayName: string }[];
  groupQuery?: string;
  plan?: { rows: any[]; source: string; groupId?: string; deptQuery?: string } | null;
  result?: { created: number; skipped: number } | null;
  error?: string | null;
}): string {
  const t = d.t;
  const statusPill = (s: string) =>
    s === "create"
      ? `<span class="pill on">will create</span>`
      : s === "exists"
      ? `<span class="pill">already here</span>`
      : `<span class="pill off">disabled in AD</span>`;
  const hasOrgConfig = d.config?.source === "org";
  const settingsForm = `
  <section class="panel">
    <h3>${hasOrgConfig ? "Update your Azure connection" : "Connect your Azure directory"}</h3>
    <p class="muted">One-time setup in your own Azure portal — takes about two minutes and needs an Azure admin:</p>
    <p class="muted" style="margin-top:8px">
    1. Sign in at <strong>portal.azure.com</strong> → <strong>Microsoft Entra ID</strong> → <strong>App registrations</strong> → <strong>New registration</strong>. Name it "OpenCard import" — no redirect URI needed.<br>
    2. On the app's <strong>Overview</strong> page, copy the <strong>Directory (tenant) ID</strong> and <strong>Application (client) ID</strong> into the fields below.<br>
    3. <strong>Certificates &amp; secrets</strong> → <strong>New client secret</strong> → copy the <em>Value</em> right away (Azure shows it only once).<br>
    4. <strong>API permissions</strong> → <strong>Add a permission</strong> → <strong>Microsoft Graph</strong> → <strong>Application permissions</strong> → tick <code>User.Read.All</code> and <code>GroupMember.Read.All</code> → <strong>Add</strong> → then click <strong>Grant admin consent</strong>.</p>
    <p class="muted">Both permissions are <strong>read-only</strong>: OpenCard can list people in your directory but can never change anything in it. The secret is stored encrypted and is never shown again here.</p>
    <form class="editor" method="POST" action="/admin/import/config" style="max-width:none;margin-top:12px">
      <div class="grid2">
        <div>
          <label>Directory (tenant) ID</label>
          <input name="tenantId" value="${esc(hasOrgConfig ? d.config!.tenantId : "")}" placeholder="00000000-0000-0000-0000-000000000000" required />
        </div>
        <div>
          <label>Application (client) ID</label>
          <input name="clientId" value="${esc(hasOrgConfig ? d.config!.clientId : "")}" placeholder="00000000-0000-0000-0000-000000000000" required />
        </div>
      </div>
      <label>Client secret ${hasOrgConfig ? `<span class="muted">(leave blank to keep the current one)</span>` : ""}</label>
      <input name="clientSecret" type="password" autocomplete="off" placeholder="${hasOrgConfig ? "unchanged" : "paste the secret Value from Azure"}" ${hasOrgConfig ? "" : "required"} />
      <div class="actions" style="margin-top:12px">
        <button class="btn" type="submit">Save &amp; test connection</button>
      </div>
    </form>
    ${
      hasOrgConfig
        ? `<form method="POST" action="/admin/import/config/delete" style="margin-top:10px" onsubmit="return confirm('Remove the Azure connection? Imported ${esc(lower(t.cardPlural))} are kept; you just won\\'t be able to import until it\\'s reconnected.')">
      <button class="btn danger secondary" type="submit">Remove connection</button>
    </form>`
        : ""
    }
  </section>`;
  const connectedLine = d.configured
    ? `<p class="muted" style="margin:0 0 14px">Connected to Azure tenant <code>${esc(d.config?.tenantId || "")}</code> · <a href="/admin/import?settings=1">Update connection</a> · <a href="/admin/sync">Sync health</a></p>`
    : "";
  const picker = `
  <section class="panel">
    <h3>Who should be imported?</h3>
    <p class="muted">Nothing is created at this step — you'll get a preview first, and pick exactly who comes in. People who already have a ${esc(lower(t.cardSingular))} or self-service account are always skipped, so re-running is safe.</p>
    <form class="editor" method="POST" action="/admin/import/preview" style="max-width:none">
      <div class="grid2">
        <div>
          <label>Everyone</label>
          <button class="btn" type="submit" name="source" value="all">Preview all directory users</button>
        </div>
        <div>
          <label>…or one group <span class="muted">(matches any word in the group name)</span></label>
          <div style="display:flex;gap:8px">
            <input name="groupQuery" value="${esc(d.groupQuery || "")}" placeholder="e.g. Sales Team" style="flex:1" />
            <button class="btn secondary" type="submit" name="source" value="groupsearch">Search</button>
          </div>
        </div>
      </div>
      <label style="margin-top:12px">…or one department <span class="muted">(matches the Department field on the person's Azure profile)</span></label>
      <div style="display:flex;gap:8px;max-width:420px">
        <input name="deptQuery" placeholder="e.g. IT, Sales, Service" style="flex:1" />
        <button class="btn secondary" type="submit" name="source" value="department">Preview</button>
      </div>
      ${
        d.groups && d.groups.length
          ? `<label style="margin-top:12px">Matching groups</label>
        <div class="self-fields">${d.groups
          .map(
            (g) =>
              `<button class="btn secondary" type="submit" name="groupId" value="${esc(g.id)}" formaction="/admin/import/preview">${esc(g.displayName)}</button>`
          )
          .join("")}</div>`
          : d.groups
          ? `<p class="muted" style="margin-top:10px">No groups matched. The search covers group names — if your team only exists as a department, use the department box instead.</p>`
          : ""
      }
    </form>
  </section>`;
  const creatable = d.plan ? d.plan.rows.filter((r: any) => r.status === "create") : [];
  const planTable = d.plan
    ? `
  <section class="panel">
    <h3>Preview — ${d.plan.rows.length} directory user${d.plan.rows.length === 1 ? "" : "s"}</h3>
    <p class="muted">${creatable.length} can be created · ${d.plan.rows.filter((r: any) => r.status === "exists").length} already exist · ${d.plan.rows.filter((r: any) => r.status === "disabled").length} disabled in the directory. Tick who to import — each new person gets a ${esc(lower(t.cardSingular))} and self-service access via their email.</p>
    <form method="POST" action="/admin/import/apply" onsubmit="return confirm('Create ' + document.querySelectorAll('.selbox:checked').length + ' ${esc(lower(t.cardPlural))} now?')">
      <input type="hidden" name="source" value="${esc(d.plan.source)}" />
      ${d.plan.groupId ? `<input type="hidden" name="groupId" value="${esc(d.plan.groupId)}" />` : ""}
      ${d.plan.deptQuery ? `<input type="hidden" name="deptQuery" value="${esc(d.plan.deptQuery)}" />` : ""}
      ${
        creatable.length
          ? `<p class="muted" style="margin:0 0 8px"><a href="#" onclick="document.querySelectorAll('.selbox').forEach(c=>c.checked=true);selCount();return false">Select all</a> · <a href="#" onclick="document.querySelectorAll('.selbox').forEach(c=>c.checked=false);selCount();return false">Select none</a></p>`
          : ""
      }
      <table class="rsp">
        <tr><th></th><th>Person</th><th>Email</th><th>Title</th><th>Department</th><th>${esc(t.locationSingular)}</th><th>Status</th></tr>
        ${d.plan.rows
          .slice(0, 200)
          .map(
            (r: any) => `<tr>
          <td data-label="Import">${
            r.status === "create"
              ? `<input type="checkbox" class="selbox" name="sel" value="${esc(r.email)}" checked onchange="selCount()" />`
              : ""
          }</td>
          <td>${esc(`${r.firstName} ${r.lastName}`.trim())}</td>
          <td data-label="Email" class="muted" style="font-size:12px">${esc(r.email)}</td>
          <td data-label="Title" class="muted">${esc(r.title || "—")}</td>
          <td data-label="Dept" class="muted">${esc(r.department || "—")}</td>
          <td data-label="${esc(t.locationSingular)}">${r.location ? esc(r.location.name) : `<span class="pill off">no ${esc(lower(t.locationSingular))}!</span>`}</td>
          <td data-label="Status">${statusPill(r.status)}</td>
        </tr>`
          )
          .join("")}
      </table>
      ${d.plan.rows.length > 200 ? `<p class="muted">Showing the first 200 of ${d.plan.rows.length} — narrow by group or department to see (and select) the rest.</p>` : ""}
      ${
        creatable.length
          ? `<div class="actions" style="margin-top:14px"><button class="btn" type="submit" id="applyBtn">Import ${creatable.length} selected</button></div>`
          : `<p class="muted" style="margin-top:14px">Nothing new to import from this selection.</p>`
      }
    </form>
    <script>
      function selCount(){var n=document.querySelectorAll('.selbox:checked').length;var b=document.getElementById('applyBtn');if(b){b.textContent='Import '+n+' selected';b.disabled=n===0;}}
    </script>
  </section>`
    : "";
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>Import from Azure AD</h2>
      <p class="muted" style="margin:0">Backfill your existing team into ${esc(lower(t.cardPlural))} — SCIM keeps future hires in sync automatically. No Azure? <a href="/admin/import/csv">Import from a spreadsheet</a> instead.</p>
    </div>
  </div>
  ${d.result ? `<p class="auth-banner" style="max-width:none">Import complete: ${d.result.created} created, ${d.result.skipped} skipped.</p>` : ""}
  ${d.testResult ? `<p class="auth-banner" style="max-width:none">${esc(d.testResult)}</p>` : ""}
  ${d.error ? `<p class="auth-error" style="max-width:none">${esc(d.error)}</p>` : ""}
  ${connectedLine}
  ${d.configured && !d.showSettings ? picker + planTable : settingsForm}`;
  return shell("Import from Azure AD", body);
}

// CSV employee import (Phase 14): upload -> map columns -> preview -> pick who
// comes in. Mirrors the Graph wizard's preview/selection UX.
export function importCsvView(d: {
  t: Terminology;
  stage?: {
    headers: string[];
    mapping: string[];
    data: string[][];
    csvB64: string;
    plan: any[] | null;
    skippedNoEmail: number;
  } | null;
  result?: { created: number; skipped: number } | null;
  error?: string | null;
}): string {
  const t = d.t;
  const statusPill = (s: string) =>
    s === "create" ? `<span class="pill on">will create</span>` : `<span class="pill">already here</span>`;
  const upload = `
  <section class="panel">
    <h3>Upload a spreadsheet</h3>
    <p class="muted">A CSV export from Excel, Google Sheets or your HR system — one row per person, with a header row. Needs at least an email column; name, title, department, phones and ${esc(lower(t.locationSingular))} are picked up when present. Nothing is created until you confirm the preview.</p>
    <form class="editor" method="POST" action="/admin/import/csv/preview" enctype="multipart/form-data" style="max-width:560px">
      <input type="file" name="csvFile" accept=".csv,text/csv" required />
      <div class="actions" style="margin-top:12px"><button class="btn" type="submit">Upload &amp; preview</button></div>
    </form>
  </section>`;
  const stage = d.stage;
  const mappingPanel = stage
    ? `
  <section class="panel">
    <h3>Column mapping</h3>
    <p class="muted">We guessed from your headers — fix anything that's wrong and hit Re-preview. Columns set to "ignore" are simply skipped.${
      stage.skippedNoEmail ? ` <strong>${stage.skippedNoEmail} row${stage.skippedNoEmail === 1 ? "" : "s"} without a valid email will be skipped.</strong>` : ""
    }</p>
    <form method="POST" action="/admin/import/csv/preview" id="mapForm">
      <input type="hidden" name="csvData" value="${esc(stage.csvB64)}" />
      <table class="rsp">
        <tr><th>Your column</th><th>Example values</th><th>Maps to</th></tr>
        ${stage.headers
          .map(
            (h, i) => `<tr>
          <td><strong>${esc(h)}</strong></td>
          <td data-label="Examples" class="muted" style="font-size:12px">${esc(
            stage.data.slice(0, 3).map((r) => r[i] || "").filter(Boolean).join(" · ").slice(0, 60)
          )}</td>
          <td data-label="Maps to"><select name="map">${CSV_TARGETS.map(
            ([v, label]) => `<option value="${esc(v)}" ${stage.mapping[i] === v ? "selected" : ""}>${esc(label)}</option>`
          ).join("")}</select></td>
        </tr>`
          )
          .join("")}
      </table>
      <div class="actions" style="margin-top:12px"><button class="btn secondary" type="submit">Re-preview with this mapping</button></div>
    </form>
  </section>`
    : "";
  const creatable = stage?.plan ? stage.plan.filter((r: any) => r.status === "create") : [];
  const planPanel =
    stage && stage.plan
      ? `
  <section class="panel">
    <h3>Preview — ${stage.plan.length} ${stage.plan.length === 1 ? "person" : "people"}</h3>
    <p class="muted">${creatable.length} can be created · ${stage.plan.length - creatable.length} already exist (always skipped). Tick who to import — each new person gets a ${esc(
          lower(t.cardSingular)
        )} and self-service access via their email.</p>
    <form method="POST" action="/admin/import/csv/apply" onsubmit="return confirm('Create ' + document.querySelectorAll('.selbox:checked').length + ' ${esc(lower(t.cardPlural))} now?')">
      <input type="hidden" name="csvData" value="${esc(stage.csvB64)}" />
      ${stage.mapping.map((m) => `<input type="hidden" name="map" value="${esc(m)}" />`).join("")}
      ${
        creatable.length
          ? `<p class="muted" style="margin:0 0 8px"><a href="#" onclick="document.querySelectorAll('.selbox').forEach(c=>c.checked=true);selCount();return false">Select all</a> · <a href="#" onclick="document.querySelectorAll('.selbox').forEach(c=>c.checked=false);selCount();return false">Select none</a></p>`
          : ""
      }
      <table class="rsp">
        <tr><th></th><th>Person</th><th>Email</th><th>Title</th><th>Department</th><th>${esc(t.locationSingular)}</th><th>Status</th></tr>
        ${stage.plan
          .slice(0, 200)
          .map(
            (r: any) => `<tr>
          <td data-label="Import">${
            r.status === "create" ? `<input type="checkbox" class="selbox" name="sel" value="${esc(r.email)}" checked onchange="selCount()" />` : ""
          }</td>
          <td>${esc(`${r.firstName} ${r.lastName}`.trim())}</td>
          <td data-label="Email" class="muted" style="font-size:12px">${esc(r.email)}</td>
          <td data-label="Title" class="muted">${esc(r.title || "—")}</td>
          <td data-label="Dept" class="muted">${esc(r.department || "—")}</td>
          <td data-label="${esc(t.locationSingular)}">${r.location ? esc(r.location.name) : `<span class="pill off">no ${esc(lower(t.locationSingular))}!</span>`}</td>
          <td data-label="Status">${statusPill(r.status)}</td>
        </tr>`
          )
          .join("")}
      </table>
      ${stage.plan.length > 200 ? `<p class="muted">Showing the first 200 of ${stage.plan.length}.</p>` : ""}
      ${
        creatable.length
          ? `<div class="actions" style="margin-top:14px"><button class="btn" type="submit" id="applyBtn">Import ${creatable.length} selected</button></div>`
          : `<p class="muted" style="margin-top:14px">Nothing new to import from this file.</p>`
      }
    </form>
    <script>
      function selCount(){var n=document.querySelectorAll('.selbox:checked').length;var b=document.getElementById('applyBtn');if(b){b.textContent='Import '+n+' selected';b.disabled=n===0;}}
    </script>
  </section>`
      : "";
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>Import from a spreadsheet</h2>
      <p class="muted" style="margin:0">Backfill your team from a CSV — no directory required. Have Azure AD? The <a href="/admin/import">Azure import</a> maps everything automatically.</p>
    </div>
  </div>
  ${d.result ? `<p class="auth-banner" style="max-width:none">Import complete: ${d.result.created} created, ${d.result.skipped} skipped.</p>` : ""}
  ${d.error ? `<p class="auth-error" style="max-width:none">${esc(d.error)}</p>` : ""}
  ${stage ? mappingPanel + planPanel : d.result ? "" : upload}`;
  return shell("Import from a spreadsheet", body);
}

// Sync health (Phase 13): what SCIM / import / JIT created, and drift between
// the directory and active cards.
export function syncView(d: {
  t: Terminology;
  overview: {
    scim: { count: number; last: Date | null };
    imported: { count: number; last: Date | null };
    csv: { count: number; last: Date | null };
    jit: { count: number; last: Date | null };
    manual: { count: number; last: Date | null };
    scimTokenSet: boolean;
    dirConfigured: boolean;
  };
  checked?: { total: number; directorySize: number; orphans: { id: string; name: string; email: string; reason: string }[] };
  flash?: string | null;
  error?: string | null;
}): string {
  const t = d.t;
  const o = d.overview;
  const when = (dt: Date | null) => (dt ? new Date(dt).toISOString().slice(0, 16).replace("T", " ") : "—");
  const srcRow = (label: string, r: { count: number; last: Date | null }, note: string) =>
    `<tr><td>${esc(label)}</td><td data-label="People">${r.count}</td><td data-label="Last created" class="muted">${when(r.last)}</td><td data-label="Notes" class="muted">${esc(note)}</td></tr>`;
  const orphanSection = d.checked
    ? d.checked.orphans.length
      ? `
  <section class="panel">
    <h3>Directory check — ${d.checked.orphans.length} orphaned ${d.checked.orphans.length === 1 ? esc(lower(t.cardSingular)) : esc(lower(t.cardPlural))}</h3>
    <p class="muted">Compared ${d.checked.total} active ${esc(lower(t.cardPlural))} against ${d.checked.directorySize} directory users. These people are gone from (or disabled in) Azure but still have a live public ${esc(lower(t.cardSingular))}. Deactivating unpublishes the ${esc(lower(t.cardSingular))} and disables self-service — nothing is deleted, and it's reversible from the ${esc(lower(t.cardSingular))} editor.</p>
    <form method="POST" action="/admin/sync/deactivate" onsubmit="return confirm('Deactivate ' + document.querySelectorAll('.selbox:checked').length + ' ${esc(lower(t.cardPlural))}?')">
      <table class="rsp">
        <tr><th></th><th>Person</th><th>Email</th><th>Reason</th></tr>
        ${d.checked.orphans
          .map(
            (x) => `<tr>
          <td data-label="Select"><input type="checkbox" class="selbox" name="sel" value="${esc(x.id)}" checked /></td>
          <td>${esc(x.name)}</td>
          <td data-label="Email" class="muted" style="font-size:12px">${esc(x.email)}</td>
          <td data-label="Reason"><span class="pill off">${esc(x.reason)}</span></td>
        </tr>`
          )
          .join("")}
      </table>
      <div class="actions" style="margin-top:14px"><button class="btn danger" type="submit">Deactivate selected</button></div>
    </form>
  </section>`
      : `
  <section class="panel">
    <h3>Directory check — all clear</h3>
    <p class="muted">All ${d.checked.total} active ${esc(lower(t.cardPlural))} correspond to enabled people in your directory (${d.checked.directorySize} directory users checked).</p>
  </section>`
    : "";
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>Sync health</h2>
      <p class="muted" style="margin:0">Where your people records come from, and whether they still match your directory.</p>
    </div>
  </div>
  ${d.flash ? `<p class="auth-banner" style="max-width:none">${esc(d.flash)}</p>` : ""}
  ${d.error ? `<p class="auth-error" style="max-width:none">${esc(d.error)}</p>` : ""}
  <section class="panel">
    <h3>Provisioning sources</h3>
    <table class="rsp">
      <tr><th>Source</th><th>People</th><th>Last created</th><th></th></tr>
      ${srcRow("SCIM (automatic)", o.scim, o.scimTokenSet ? "token configured" : "no SCIM token set")}
      ${srcRow("Azure import wizard", o.imported, o.dirConfigured ? "directory connected" : "directory not connected")}
      ${srcRow("Spreadsheet import (CSV)", o.csv, "")}
      ${srcRow("SSO first sign-in (JIT)", o.jit, "enable on the Integrations page")}
      ${srcRow("Created by admins", o.manual, "")}
    </table>
  </section>
  <section class="panel">
    <h3>Check against the directory</h3>
    <p class="muted">Read-only comparison: finds active ${esc(lower(t.cardPlural))} whose owner no longer exists (or is disabled) in Azure — departed employees whose public pages are still live. ${o.dirConfigured ? "" : `Requires the Azure connection from the <a href="/admin/import">Import page</a>.`}</p>
    <form method="POST" action="/admin/sync/check">
      <button class="btn" type="submit" ${o.dirConfigured ? "" : "disabled"}>Run directory check</button>
    </form>
  </section>
  ${orphanSection}`;
  return shell("Sync health", body);
}

// API reference (Phase 14): docs/API.md rendered server-side.
export function apiDocsView(html: string): string {
  const body = `
  <p class="crumb"><a href="/admin/integrations">← Integrations</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>API reference</h2>
      <p class="muted" style="margin:0">REST API for CRMs, HRIS and automation — authenticate with an API key from the Integrations page.</p>
    </div>
  </div>
  <section class="panel md-doc" style="max-width:860px">${html}</section>`;
  return shell("API reference", body);
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
        <td>${esc(a.email)}</td><td data-label="Name">${esc(a.name || "")}</td>
        <td data-label="Role">${esc(ROLE_LABELS[a.role as keyof typeof ROLE_LABELS] || a.role)}</td>
        <td data-label="Scope" class="muted">${esc(scopeTxt)}</td>
        <td data-label="2FA">${mfa}</td>
        <td data-label="Status">${a.active ? `<span class="pill on">active</span>` : `<span class="pill off">disabled</span>`}</td>
        <td class="rsp-actions"><a href="/admin/admins/${esc(a.id)}/edit">Edit</a></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">No admin accounts yet. The ADMIN_TOKEN is the bootstrap super admin.</td></tr>`;
  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar"><h2>Admin accounts</h2><a class="btn" href="/admin/admins/new">+ New admin</a></div>
  <p class="muted">Super (everything), General (all brands' content), Brand (assigned brands), Store (assigned stores' cards). SSO admins get MFA from your IdP; password admins enroll an authenticator app on first sign-in.</p>
  <table class="rsp"><tr><th>Email</th><th>Name</th><th>Role</th><th>Scope</th><th>2FA</th><th>Status</th><th></th></tr>${rows}</table>`;
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
  <p class="crumb"><a href="/admin/admins">← Admins</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>${opts.admin ? `Edit admin — ${esc(a.email)}` : "New admin"}</h2>
      <p class="muted" style="margin:0">${opts.admin ? "Role, scope, and sign-in settings for this admin." : "Invite an admin to this workspace. Scope what they can manage with the role."}</p>
    </div>
  </div>
  <form class="editor" method="POST" action="${action}" style="max-width:640px">
    <h3>Account</h3>
    <div class="grid2">
      <div><label>Email</label><input name="email" type="email" value="${esc(a.email)}" ${
    opts.admin ? "readonly" : ""
  } required placeholder="admin@yourco.com" /></div>
      <div><label>Name</label><input name="name" value="${esc(a.name)}" placeholder="Jane Doe" /></div>
    </div>

    <h3>Role &amp; scope</h3>
    <p class="muted">Super: everything. General: all brands' content. Brand / Store admins manage only what you check below.</p>
    <label>Role</label>
    <select name="role" id="role-sel">${roles
      .map((r) => `<option value="${r}" ${a.role === r ? "selected" : ""}>${esc(ROLE_LABELS[r])}</option>`)
      .join("")}</select>

    <div id="brand-scope" class="scope-box">
      <label>Brands this admin manages</label>
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
      <label>Stores this admin manages</label>
      <div class="self-fields">${opts.locations
        .map(
          (l: any) =>
            `<label class="chk"><input type="checkbox" name="locationScope" value="${esc(l.id)}" ${
              locSet.has(l.id) ? "checked" : ""
            } /> ${esc(l.brand?.name || "")} — ${esc(l.name)}</label>`
        )
        .join("")}</div>
    </div>

    <h3>Sign-in</h3>
    ${
      opts.admin
        ? ""
        : `<label class="chk" style="margin-bottom:10px"><input type="checkbox" name="sendInvite" value="1" checked /> Email them an invite link so they set their own password <span class="muted">(recommended)</span></label>`
    }
    <label>Password <span class="muted">${opts.admin ? "(leave blank to keep current — changing it signs out their sessions)" : "(optional — leave blank to use the invite link, or for SSO-only accounts)"}</span></label>
    <input name="password" type="password" autocomplete="new-password" />
    <p class="muted" style="margin:6px 0 0">Password admins must enroll an authenticator app on first sign-in. SSO admins inherit MFA from your identity provider.</p>
    ${
      opts.admin
        ? `<label class="chk" style="margin-top:12px"><input type="checkbox" name="active" value="1" ${
            a.active ? "checked" : ""
          } /> Active</label>
    <label class="chk"><input type="checkbox" name="resetMfa" value="1" /> Reset two-factor (force re-enroll)</label>`
        : ""
    }
    <div class="form-actions"><button class="btn" type="submit">${opts.admin ? "Save changes" : "Create admin"}</button>
    <a class="btn secondary" href="/admin/admins">Cancel</a></div>
  </form>
  ${
    opts.admin
      ? `<div class="danger-zone" style="max-width:640px">
    <h3>Delete this admin</h3>
    <p class="muted">Removes ${esc(a.email)}'s access immediately. This cannot be undone.</p>
    <form method="POST" action="/admin/admins/${esc(
      a.id
    )}/delete" onsubmit="return confirm('Delete this admin account?')"><button class="btn danger" type="submit">Delete admin</button></form>
  </div>`
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
  crmIntegrations?: any[];
  crmLocations?: { id: string; name: string }[];
  leadWebhookUrl?: string;
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

  // ---- CRM / marketing sync section ----
  const syncBadge = (s: string) =>
    s === "sent"
      ? `<span class="pill on">sent</span>`
      : s === "failed"
      ? `<span class="pill off">failed</span>`
      : s === "dead"
      ? `<span class="pill off">dead-letter</span>`
      : `<span class="pill">${esc(s)}</span>`;
  const crmIntegrations = data.crmIntegrations || [];
  const crmLocations = data.crmLocations || [];
  const crmRows = crmIntegrations.length
    ? crmIntegrations
        .map((c) => {
          const scope = c.locationId ? esc(crmLocations.find((l) => l.id === c.locationId)?.name || "one rooftop") : "All rooftops";
          const logs = (c.syncLogs || [])
            .map(
              (g: any) =>
                `<div class="muted" style="font-size:12px;margin-top:4px">${syncBadge(g.status)} ${
                  g.responseCode ? `HTTP ${g.responseCode}` : ""
                } · ${esc(new Date(g.updatedAt).toISOString().slice(0, 16).replace("T", " "))}${
                  g.lastError ? ` · ${esc(String(g.lastError).slice(0, 80))}` : ""
                }${
                  g.status === "failed"
                    ? ` <form method="POST" action="/admin/crm/logs/${esc(g.id)}/retry" style="display:inline"><button class="btn secondary" style="padding:2px 8px;font-size:11px" type="submit">Retry</button></form>`
                    : ""
                }</div>`
            )
            .join("");
          return `<div class="item-card">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
          <div><strong>${esc(c.name)}</strong> <span class="pill">${esc(c.provider)}</span> ${
            c.enabled ? `<span class="pill on">enabled</span>` : `<span class="pill off">off</span>`
          }<br><span class="muted" style="font-size:12px">→ ${
            c.provider === "hubspot"
              ? `HubSpot contact upsert ${c.token ? `<span class="pill on">token set</span>` : `<span class="pill off">no token</span>`}`
              : c.provider === "salesforce"
              ? `Salesforce Web-to-Lead ${c.token ? `<span class="pill on">oid set</span>` : `<span class="pill off">no oid</span>`}`
              : `<code>${esc(String(c.endpoint || "").slice(0, 60))}</code>`
          } · ${esc(scope)}</span></div>
          <div style="white-space:nowrap">
            <form method="POST" action="/admin/crm/${esc(c.id)}/test" style="display:inline"><button class="btn secondary" type="submit">Send test</button></form>
            <form method="POST" action="/admin/crm/${esc(c.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this integration?')"><button class="btn danger" type="submit">Delete</button></form>
          </div>
        </div>
        ${logs || `<div class="muted" style="font-size:12px;margin-top:4px">No sync attempts yet.</div>`}
      </div>`;
        })
        .join("")
    : `<p class="muted">No CRM integrations yet. Add one below — leads captured from cards and QR assets are pushed automatically.</p>`;
  const crmScopeOptions =
    `<option value="">All rooftops</option>` +
    crmLocations.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
  const crmFieldHelp = CRM_SOURCE_FIELDS.map(([k]) => `<code>${esc(k)}</code>`).join(", ");
  const crmSection = `
  <section class="panel">
  <h3>CRM &amp; marketing sync</h3>
  <p class="muted">Push every captured lead to your CRM, Zapier, or Make in real time. Point it at a Zapier/Make "Catch Hook" (or any webhook) URL — we POST a normalized lead payload. Field mapping and per-rooftop routing are optional.</p>
  ${crmRows}
  <form class="editor" method="POST" action="/admin/crm" id="crm-add">
    <label>Name</label>
    <input name="name" placeholder="e.g. HubSpot production" required />
    <label style="margin-top:10px">Provider</label>
    <select name="provider" id="crm-provider">
      <option value="zapier">Zapier / Make / generic webhook</option>
      <option value="hubspot">HubSpot (contact upsert)</option>
      <option value="salesforce">Salesforce (Web-to-Lead)</option>
    </select>
    <div class="crm-zapier">
      <label style="margin-top:10px">Webhook URL <span class="muted">(Zapier/Make catch hook or any endpoint)</span></label>
      <input name="endpoint" type="url" placeholder="https://hooks.zapier.com/hooks/catch/..." />
    </div>
    <div class="crm-hubspot" style="display:none">
      <label style="margin-top:10px">HubSpot private-app token</label>
      <input name="token" type="password" placeholder="pat-na1-..." autocomplete="off" />
      <p class="muted" style="font-size:12px;margin:4px 0 0">In HubSpot: Settings → Integrations → Private Apps → create an app with the <code>crm.objects.contacts.write</code> scope, then paste its token here. We upsert a contact by email on every captured lead.</p>
    </div>
    <div class="crm-salesforce" style="display:none">
      <label style="margin-top:10px">Salesforce Org ID (oid)</label>
      <input name="sfOid" placeholder="00Dxx0000001abc" autocomplete="off" />
      <label style="margin-top:8px">Submission URL override <span class="muted">(optional; blank = standard Web-to-Lead)</span></label>
      <input name="sfUrl" type="url" placeholder="https://webto.salesforce.com/..." />
      <p class="muted" style="font-size:12px;margin:4px 0 0">Find your Org ID in Salesforce Setup → Company Information. Each captured lead creates a Salesforce Lead via Web-to-Lead. Note: Salesforce returns no delivery confirmation, so a "sent" status means it was accepted for processing.</p>
    </div>
    <label style="margin-top:10px">Applies to</label>
    <select name="locationId">${crmScopeOptions}</select>
    <label style="margin-top:10px">Field mapping <span class="muted">(optional, one per line: <code>targetKey = leadField</code>; blank = default mapping)</span></label>
    <textarea name="fieldMap" rows="3" placeholder="firstname = name&#10;email = email&#10;phone = phone"></textarea>
    <p class="muted" style="font-size:12px;margin:6px 0 0"><span class="crm-hubspot" style="display:none">For HubSpot, target keys are contact property names (firstname, lastname, email, phone, company, or a custom property). </span><span class="crm-salesforce" style="display:none">For Salesforce, target keys are Web-to-Lead field names (first_name, last_name, email, phone, company, or a custom field id like 00N…). </span>Lead fields: ${crmFieldHelp}</p>
    <p style="margin-top:10px"><button class="btn" type="submit">Add integration</button></p>
    <script>(function(){
      var f=document.getElementById('crm-add'); if(!f) return;
      var sel=document.getElementById('crm-provider');
      var provs=['zapier','hubspot','salesforce'];
      function sync(){ provs.forEach(function(pv){
        var show=sel.value===pv;
        f.querySelectorAll('.crm-'+pv).forEach(function(e){e.style.display=show?'':'none';});
      }); }
      sel.addEventListener('change',sync); sync();
    })();</script>
  </form>
  </section>`;

  const body = `
  <p class="crumb"><a href="/admin">← Dashboard</a></p>
  <div class="topbar">
    <div style="flex-direction:column;align-items:flex-start;gap:2px">
      <h2>Integrations</h2>
      <p class="muted" style="margin:0">API keys, single sign-on, provisioning, webhooks and CRM sync for this workspace.</p>
    </div>
    <div><a class="btn secondary" href="/admin/api-docs">API reference</a></div>
  </div>

  ${
    data.newKey
      ? `<div class="stat" style="border:1px solid #16a34a;background:#f0fdf4;margin-bottom:16px">
      <strong>New API key created — copy it now, it won't be shown again:</strong>
      <p><code style="font-size:14px;word-break:break-all">${esc(data.newKey)}</code></p>
    </div>`
      : ""
  }

  <section class="panel">
  <h3>REST API</h3>
  <p class="muted">Base URL: <code>${esc(data.baseUrl)}/api/v1</code>. Authenticate with <code>Authorization: Bearer &lt;key&gt;</code>.</p>
  <table>
    <tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th>Status</th><th></th></tr>
    ${keyRows}
  </table>
  <form class="editor" method="POST" action="/admin/api-keys">
    <label>Create API key — name</label>
    <input name="name" placeholder="e.g. Zapier, CRM sync" required />
    <label style="margin-top:10px">Permissions <span class="muted">(leave all unchecked for full access)</span></label>
    <div class="self-fields">${API_SCOPES.map(
      (s) => `<label class="chk"><input type="checkbox" name="scopes" value="${esc(s)}" /> ${esc(SCOPE_LABELS[s])}</label>`
    ).join("")}</div>
    <p style="margin-top:10px"><button class="btn" type="submit">Create key</button></p>
  </form>
  </section>

  <section class="panel">
  <h3>Lead alerts in Slack / Teams</h3>
  <p class="muted">Post every new lead to a channel the moment it lands — alongside the email notifications, not instead of them.</p>
  <p class="muted" style="margin-top:6px">
  <strong>Slack:</strong> channel → ⚙ → Integrations → Add an app → <em>Incoming Webhooks</em> → copy the webhook URL.<br>
  <strong>Teams:</strong> channel → ⋯ → Connectors (or Workflows → "Post to a channel when a webhook request is received") → copy the URL.</p>
  <form class="editor" method="POST" action="/admin/lead-webhook" style="max-width:760px;margin-top:10px">
    <label>Incoming webhook URL <span class="muted">(blank to turn off)</span></label>
    <input name="leadWebhookUrl" type="url" value="${esc(data.leadWebhookUrl || "")}" placeholder="https://hooks.slack.com/services/…" />
    <p style="margin-top:10px"><button class="btn" type="submit">Save</button>
    ${data.leadWebhookUrl ? `<button class="btn secondary" type="submit" formaction="/admin/lead-webhook/test">Send test message</button>` : ""}</p>
  </form>
  </section>

  <section class="panel">
  <h3>SAML single sign-on</h3>
  <p class="muted">Let employees sign in to self-service (/me) with your identity provider — Okta, Entra, Google Workspace, etc.</p>
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
  ${
    data.samlHost
      ? `<details style="margin:0 0 12px;padding:10px 14px;background:var(--wash-2, #f8fafc);border:1px solid var(--line, #e5e7eb);border-radius:10px">
    <summary style="cursor:pointer;font-weight:600;color:var(--accent, #1F5BEA)">Setup instructions (Entra / Okta) — click to expand</summary>
    <p class="muted" style="margin-top:8px">
    1. Create a SAML app in your IdP.<br>
    &nbsp;&nbsp;&nbsp;<strong>Microsoft Entra:</strong> portal.azure.com → <strong>Microsoft Entra ID</strong> → <strong>Enterprise applications</strong> → <strong>New application</strong> → <strong>Create your own application</strong> → "Integrate any other application you don't find in the gallery" → then <strong>Single sign-on → SAML</strong>.<br>
    &nbsp;&nbsp;&nbsp;<strong>Okta:</strong> Admin console → <strong>Applications</strong> → <strong>Create App Integration</strong> → <strong>SAML 2.0</strong>.<br>
    2. Paste the two values from above into the app:<br>
    &nbsp;&nbsp;&nbsp;<strong>SP entity ID</strong> → Entra calls it <em>Identifier (Entity ID)</em>; Okta calls it <em>Audience URI (SP Entity ID)</em>.<br>
    &nbsp;&nbsp;&nbsp;<strong>ACS / reply URL</strong> → Entra: <em>Reply URL (Assertion Consumer Service URL)</em>; Okta: <em>Single sign-on URL</em>.<br>
    3. Make sure the assertion identifies people by <strong>email</strong>: Entra — leave the Unique User Identifier as <code>user.userprincipalname</code> if that's their email (otherwise pick <code>user.mail</code>); Okta — Name ID format <em>EmailAddress</em>, application username <em>Email</em>.<br>
    4. Copy three values from the IdP into the form below:<br>
    &nbsp;&nbsp;&nbsp;<strong>IdP SSO URL</strong> → Entra: <em>Login URL</em>; Okta: <em>Sign on URL</em> (on the app's Sign On tab / metadata).<br>
    &nbsp;&nbsp;&nbsp;<strong>IdP issuer</strong> → Entra: <em>Microsoft Entra Identifier</em>; Okta: <em>Issuer</em>.<br>
    &nbsp;&nbsp;&nbsp;<strong>Signing certificate</strong> → Entra: download <em>Certificate (Base64)</em>; Okta: the <em>X.509 Certificate</em>. Paste the whole thing, BEGIN/END lines included.<br>
    5. Assign your users to the app in the IdP, tick <strong>Enable SAML sign-in</strong> below, and save.</p>
    <p class="muted">After that, your team signs in at the address above. Access is matched by <strong>email</strong> — the address your IdP sends must equal the email on the person's card (or admin account). Sign-in only: nothing is ever written to your directory. To auto-create cards for new hires, use SCIM below or the Azure import wizard.</p>
  </details>`
      : ""
  }
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
    <label class="chk" style="margin-top:12px"><input type="checkbox" name="jitEnabled" value="1" ${
      saml.jitEnabled ? "checked" : ""
    } /> Auto-create cards on first sign-in (JIT provisioning)</label>
    <p class="muted" style="margin:4px 0 0">When someone signs in through your IdP and has no card yet, one is created from their name/title in the SAML assertion — instead of a "no card assigned" page. People who already have a card are never touched. Anyone your IdP lets into this app gets a card, so scope the app's user assignment accordingly.</p>
    <p style="margin-top:10px"><button class="btn" type="submit">Save SSO settings</button></p>
  </form>
  </section>

  <section class="panel">
  <h3>SCIM provisioning</h3>
  <p class="muted">Auto-create and deactivate cards from your directory (Entra, Okta) — new hires get a card automatically.</p>
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
    <p class="muted" style="margin-top:6px"><a href="/admin/sync">Sync health →</a> — see what SCIM/import/JIT created and find cards for people who left.</p>
  </div>
  <form method="POST" action="/admin/scim-token/generate" onsubmit="return confirm('${
    data.scimTokenSet ? "Regenerate the SCIM token? The current token will stop working." : "Generate a SCIM token?"
  }')">
    <button class="btn" type="submit">${data.scimTokenSet ? "Regenerate token" : "Generate token"}</button>
  </form>
  </section>

  <section class="panel">
  <h3>Webhooks</h3>
  <p class="muted">We POST signed JSON to your URL on each subscribed event. Verify with the <code>X-OpenCard-Signature</code> header (HMAC-SHA256 of the body, using the endpoint secret).</p>
  <table>
    <tr><th>URL</th><th>Events</th><th>Status</th><th>Last delivery</th><th>Secret</th><th></th></tr>
    ${epRows}
  </table>
  <form class="editor" method="POST" action="/admin/webhooks">
    <label>Endpoint URL</label>
    <input name="url" type="url" placeholder="https://example.com/hooks/opencard" required />
    <label>Events</label>
    <div class="self-fields">${eventChecks}</div>
    <p style="margin-top:10px"><button class="btn" type="submit">Add webhook</button></p>
  </form>
  </section>

  ${crmSection}`;
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
  <p class="crumb"><a href="/admin/integrations">← Integrations</a></p>
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
  </table>`;
  return shell("Webhook deliveries", body);
}

export function analyticsView(stats: {
  totals: Record<string, number>;
  topCards: { name: string; slug: string; views: number }[];
  leadCount?: number;
  conversion?: number;
  assetScans?: number;
  leaderboard?: { id: string; name: string; views: number; leads: number; conv: number }[];
  viewSeries?: { day: string; count: number }[];
  funnel?: { status: string; label: string; count: number }[];
  sources?: { key: string; count: number }[];
  campaigns?: { key: string; count: number }[];
  employees?: { key: string; count: number }[];
  deptPerf?: { key: string; count: number }[];
  range?: { key: string; label: string };
  ranges?: [string, string][];
  locationLabel?: string;
  reports?: { csvUrl: string; emails: string; cadence: string; sent: boolean };
}): string {
  const t = stats.totals;
  const rp = stats.reports;
  const reportsSection = rp
    ? `<h3 style="margin-top:28px">Reports</h3>
  ${rp.sent ? `<p class="auth-banner" style="max-width:none">Digest sent (or logged if SMTP isn't configured).</p>` : ""}
  <p><a class="btn secondary" href="${esc(rp.csvUrl)}">⬇ Download CSV</a></p>
  <form class="editor" method="POST" action="/admin/reports/digest" style="max-width:560px;margin-top:8px">
    <label>Manager digest recipients <span class="muted">(comma-separated emails)</span></label>
    <input name="digestEmails" value="${esc(rp.emails)}" placeholder="gm@dealer.com, marketing@dealer.com" />
    <label style="margin-top:8px">Cadence</label>
    <select name="cadence">
      <option value="off" ${rp.cadence === "off" ? "selected" : ""}>Off</option>
      <option value="weekly" ${rp.cadence === "weekly" ? "selected" : ""}>Weekly</option>
    </select>
    <p class="muted" style="font-size:12px;margin:6px 0 0">A weekly summary (last 7 days) is emailed to these recipients.</p>
    <p style="margin-top:10px"><button class="btn" type="submit">Save digest</button>
    <button class="btn secondary" type="submit" formaction="/admin/reports/digest/test">Send test now</button></p>
  </form>`
    : "";
  const kvTable = (title: string, rows: { key: string; count: number }[] | undefined, col: string) =>
    rows
      ? `<h3 style="margin-top:24px">${esc(title)}</h3>
  <table><tr><th>${esc(col)}</th><th>Leads</th></tr>${
        rows.length
          ? rows.map((r) => `<tr><td>${esc(r.key)}</td><td>${r.count}</td></tr>`).join("")
          : `<tr><td colspan="2" class="muted">None in this range.</td></tr>`
      }</table>`
      : "";
  const viewChart = stats.viewSeries && svgAreaChart(stats.viewSeries);
  const viewChartSection = viewChart
    ? `<h3 style="margin-top:24px">Views over time</h3>
  <div class="panel" style="padding:14px">${viewChart}</div>`
    : "";
  const funnelBars = stats.funnel ? svgBars(stats.funnel.map((s) => ({ label: s.label, count: s.count }))) : "";
  const funnelSection = stats.funnel
    ? `<h3 style="margin-top:24px">Lead funnel</h3>
  ${
    stats.funnel.some((s) => s.count > 0)
      ? `<div class="panel" style="padding:14px">${funnelBars}</div>`
      : `<p class="muted">No leads in this range yet.</p>`
  }`
    : "";
  const sourceBars =
    stats.sources && stats.sources.length
      ? `<h3 style="margin-top:24px">Lead source mix</h3>
  <div class="panel" style="padding:14px">${svgBars(stats.sources.map((s) => ({ label: s.key, count: s.count })))}</div>`
      : "";
  const leadCount = stats.leadCount ?? (t.connect || 0);
  const conversion = stats.conversion ?? 0;
  const assetScans = stats.assetScans ?? 0;
  const ranges = stats.ranges || [];
  const rangeTabs = ranges.length
    ? `<div style="margin:8px 0 18px">${ranges
        .map(
          ([k, label]) =>
            `<a class="btn ${k === stats.range?.key ? "" : "secondary"}" href="/admin/analytics?range=${esc(k)}" style="padding:6px 12px">${esc(
              label
            )}</a>`
        )
        .join(" ")}</div>`
    : "";
  const locLabel = stats.locationLabel || "Location";
  const leaderboardSection = stats.leaderboard
    ? `<h3 style="margin-top:24px">${esc(locLabel)} leaderboard</h3>
  <table>
    <tr><th>${esc(locLabel)}</th><th>Views</th><th>Leads</th><th>Conv.</th></tr>
    ${
      stats.leaderboard.length
        ? stats.leaderboard.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.views}</td><td>${r.leads}</td><td>${r.conv}%</td></tr>`).join("")
        : `<tr><td colspan="4" class="muted">No ${esc(lower(locLabel))} activity in this range.</td></tr>`
    }
  </table>`
    : "";
  const body = `
  <div class="topbar"><h2>Analytics</h2></div>
  ${stats.range ? `<p class="muted">${esc(stats.range.label)} · <a href="/admin/leads">view leads</a></p>` : ""}
  ${rangeTabs}

  <div class="cards-grid">
    <div class="stat"><div class="n">${t.view || 0}</div><div class="muted">Card views</div></div>
    <div class="stat"><div class="n">${t.vcard || 0}</div><div class="muted">Contacts saved</div></div>
    <div class="stat"><div class="n">${t.click || 0}</div><div class="muted">Link clicks</div></div>
    <div class="stat"><div class="n">${leadCount}</div><div class="muted">Leads captured</div></div>
    <div class="stat"><div class="n">${conversion}%</div><div class="muted">View → lead rate</div></div>
    <div class="stat"><div class="n">${assetScans}</div><div class="muted">QR asset scans <span style="font-size:10px">(all-time)</span></div></div>
  </div>

  ${viewChartSection}
  ${leaderboardSection}
  ${funnelSection}
  ${sourceBars}
  ${kvTable("Campaign performance", stats.campaigns, "Campaign")}
  ${kvTable("Top employees by leads", stats.employees, "Employee")}
  ${kvTable("Department performance", stats.deptPerf, "Department")}
  ${reportsSection}

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
  </table>`;
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
  <table class="rsp">
    <tr><th>When</th><th>Name</th><th>Contact</th><th>Interest</th><th>Source</th><th>Status</th><th>From</th></tr>
    ${
      leads.length
        ? leads
            .map(
              (l) => `<tr>
        <td data-label="When" class="muted" style="white-space:nowrap">${esc(
          new Date(l.createdAt).toISOString().slice(0, 16).replace("T", " ")
        )}</td>
        <td><a href="/admin/leads/${esc(l.id)}">${esc(l.name)}</a>${
                l.duplicateOfId ? ` <span class="pill off" style="font-size:10px">dup</span>` : ""
              }${l.company ? `<br><span class="muted" style="font-size:11px">${esc(l.company)}</span>` : ""}</td>
        <td data-label="Contact" style="font-size:12px">${esc(l.email || "")}${l.email && l.phone ? "<br>" : ""}${esc(l.phone || "")}${
                l.preferredContact ? `<br><span class="muted">prefers ${esc(l.preferredContact)}</span>` : ""
              }</td>
        <td data-label="Interest" style="font-size:12px">${esc(l.vehicleInterest || l.serviceNeed || "")}${
                (l.vehicleInterest || l.serviceNeed) && flags(l) ? "<br>" : ""
              }${flags(l)}</td>
        <td data-label="Source" style="font-size:12px">${source(l)}</td>
        <td data-label="Status"><span class="pill ${l.status === "new" ? "on" : "off"}">${esc(STATUS_LABELS[l.status] || l.status || "new")}</span>${
                l.assignedTo ? `<br><span class="muted" style="font-size:11px">${esc(l.assignedTo)}</span>` : ""
              }</td>
        <td data-label="From">${
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
  </table>`;
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
  <p class="crumb"><a href="/admin/leads">← Leads</a></p>
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

  <div class="danger-zone" style="margin-top:20px;max-width:820px">
    <h3>Erase this lead</h3>
    <p class="muted">Permanently deletes this lead and its history (right to erasure). Recorded in the audit log. This cannot be undone.</p>
    <form method="POST" action="/admin/leads/${esc(l.id)}/delete" onsubmit="return confirm('Permanently erase this lead? This cannot be undone.')">
      <button class="btn danger" type="submit">Erase lead</button>
    </form>
  </div>`;
  return shell("Lead", body);
}
