import crypto from "crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma, LabeledValue, SocialLink, Address } from "../db";
import { config } from "../config";
import { clearCookieOptions, cookieOptions } from "../cookies";
import { requireAdmin, reqAdmin, forbidden, loginPage, mfaPage, enrollPage } from "../middleware/auth";
import { page, esc } from "../views/html";
import { uniqueSlug, uniqueAssetSlug } from "../slug";
import { upload, uploadedUrl } from "../upload";
import { emitEvent, cardPayload, WEBHOOK_EVENTS, replayDelivery, sendTestEvent } from "../webhooks";
import { parseOemBrands, parseCtaLines, rooftopCtas, ctasFromJson, mergeCtas } from "../dealership";
import { buildSignatureModel, renderSignatureHtml, renderSignatureText } from "../signature";
import { signatureBlock } from "../views/signature-view";
import { parseCampaignRoutingLines } from "../routing";
import { LEAD_STATUSES, canTransition } from "../leadstatus";
import { redirectTargetUrl, offboardCardUpdate, replacementCardData } from "../turnover";
import { assetTypeLabel } from "../assets";
import { generateApiKey } from "../apiauth";
import { sanitizeScopes } from "../api-scopes";
import { generateScimToken } from "../scim-auth";
import { getSamlConfigForOrg, samlAcsUrl, samlSpIssuer, orgCanonicalHost } from "../saml";
import { signEmail, verifyEmail } from "../selfauth";
import { hashPassword, verifyPassword, generateTotpSecret, totpUri, verifyTotp } from "../security";
import { qrDataUrl } from "../qr";
import { currentTerminology } from "../terminology";
import { defaultOrgId, orgIdForBrand, orgIdForLocation } from "../tenant";
import { canAdd, orgHasFeature, orgPlanKey, orgUsage, orgAccessState } from "../entitlements";
import { requiredPlanFor, planFor, PLANS, PLAN_ORDER, isPlanKey, Feature, LimitKey } from "../plans";
import { accessSummary } from "../access";
import { stripe, stripeEnabled } from "../stripe";
import * as RBAC from "../rbac";
import * as V from "../views/admin";

// Plan-gate helpers: reject with a friendly upgrade message.
function limitReached(res: any, what: string) {
  return forbidden(res, `You've reached your plan's ${what} limit. Upgrade your plan to add more.`);
}
async function ensureFeature(res: any, orgId: string, feature: Feature, label: string): Promise<boolean> {
  if (await orgHasFeature(orgId, feature)) return true;
  const need = requiredPlanFor(feature);
  forbidden(res, `${label} isn't included in your plan.${need ? ` It's available on the ${need.label} plan and above.` : ""}`);
  return false;
}

export const adminRouter = Router();

// ---------- auth ----------
adminRouter.get("/login", (req, res) =>
  res.send(loginPage(undefined, req.query.welcome ? "Account created. Sign in to continue." : undefined))
);

// Super-admin break-glass token login.
adminRouter.post("/login/token", (req, res) => {
  if ((req.body?.token || "") === config.adminToken) {
    res.cookie("oc_admin", config.adminToken, cookieOptions(12 * 60 * 60 * 1000));
    return res.redirect("/admin");
  }
  res.status(401).send(loginPage("Invalid token."));
});

// Email + password. MFA is optional: if the account has it enabled we ask for a
// code, otherwise we sign in directly. Admins can turn MFA on later under
// Admin -> Security.
adminRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();
  const password = String(req.body?.password || "");
  const au = await prisma.adminUser.findUnique({ where: { email } });
  if (!au || !au.active || !verifyPassword(password, au.passwordHash)) {
    return res.status(401).send(loginPage("Invalid email or password."));
  }
  if (au.mfaEnabled && au.mfaSecret) {
    res.cookie("oc_pwauth", signEmail(email), cookieOptions(5 * 60 * 1000));
    return res.send(mfaPage());
  }
  res.cookie("oc_emp", signEmail(email), cookieOptions(12 * 60 * 60 * 1000));
  return res.redirect("/admin");
});

adminRouter.post("/login/mfa", async (req, res) => {
  const email = verifyEmail(req.cookies?.oc_pwauth);
  if (!email) return res.redirect("/admin/login");
  const au = await prisma.adminUser.findUnique({ where: { email } });
  if (!au || !au.mfaSecret || !verifyTotp(au.mfaSecret, String(req.body?.code || ""))) {
    return res.status(401).send(mfaPage("Incorrect code, try again."));
  }
  res.clearCookie("oc_pwauth", clearCookieOptions());
  res.cookie("oc_emp", signEmail(email), cookieOptions(12 * 60 * 60 * 1000));
  res.redirect("/admin");
});

adminRouter.get("/logout", (_req, res) => {
  res.clearCookie("oc_admin", clearCookieOptions());
  res.clearCookie("oc_emp", clearCookieOptions());
  res.redirect("/admin/login");
});

// everything below requires an admin principal (attached as req.admin)
adminRouter.use(requireAdmin);

// Workspace access gate: when a tenant's demo/trial has lapsed (or a subscription
// is past due / canceled), block state-changing actions and steer them to billing.
// Reads still work, so they can see their data and the plan page. Platform owners
// and the billing/logout routes are always allowed.
adminRouter.use(async (req, res, next) => {
  const p = reqAdmin(req);
  if (p.platform || req.method !== "POST") return next();
  if (req.path === "/logout" || req.path.startsWith("/billing")) return next();
  const access = await orgAccessState(p.orgId);
  if (access.active) return next();
  return res.status(402).send(
    page({
      title: "Subscription required",
      body: `<main class="card" style="max-width:520px"><section class="ident"><h1>Subscription required</h1><p class="company">${esc(
        accessSummary(access)
      )}. Choose a plan to keep making changes.</p></section><a class="cta" href="/admin/billing">Go to billing</a></main>`,
    })
  );
});

// ---------- helpers ----------
function parseLabeled(text: string): LabeledValue[] {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [label, ...rest] = l.split("|");
      const value = rest.join("|").trim();
      return value ? { label: label.trim() || "", value } : { label: "", value: label.trim() };
    })
    .filter((x) => x.value);
}
function parseSocials(text: string): SocialLink[] {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [type, ...rest] = l.split("|");
      return { type: (type || "").trim().toLowerCase(), value: rest.join("|").trim() };
    })
    .filter((x) => x.value);
}
// Returns a plain string map (no undefined values) so it's cleanly assignable
// to a Prisma JSON field, or null when empty.
function parseAddress(b: any): Record<string, string> | null {
  const out: Record<string, string> = {};
  const put = (k: string, v: any) => {
    if (v && String(v).trim()) out[k] = String(v).trim();
  };
  put("line1", b.addr_line1);
  put("city", b.addr_city);
  put("region", b.addr_region);
  put("postal", b.addr_postal);
  put("country", b.addr_country);
  return Object.keys(out).length ? out : null;
}
const clean = (s: any) => (s && String(s).trim() ? String(s).trim() : null);

// Normalize an HTML checkbox group (absent | single string | string[]) to string[].
function asArray(v: any): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v === undefined || v === null || v === "") return [];
  return [String(v)];
}

// ---------- dashboard ----------
adminRouter.get("/", async (req, res) => {
  const p = reqAdmin(req);
  const t = await currentTerminology();
  const brandIds = await RBAC.accessibleBrandIds(p);
  const locFilter = p.global ? undefined : { id: { in: await RBAC.accessibleLocationIds(p) } };
  const brands = await prisma.brand.findMany({
    where: { id: { in: brandIds } },
    orderBy: { name: "asc" },
    include: {
      locations: {
        where: locFilter,
        orderBy: { name: "asc" },
        include: { _count: { select: { cards: true } } },
      },
    },
  });
  res.send(V.dashboard(brands as any, p, t));
});

// ---------- security (per-account two-factor) ----------
function securityShell(inner: string): string {
  return page({
    title: "Security",
    body: `<main class="card" style="max-width:560px"><section class="ident"><h1>Security</h1></section>${inner}<p style="margin-top:18px"><a class="btn secondary" href="/admin">Back to admin</a></p></main>`,
  });
}

adminRouter.get("/security", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) {
    return res.send(
      securityShell(
        `<p class="company">You're signed in with the break-glass token, which has no stored account. Two-factor applies to email/password admin accounts.</p>`
      )
    );
  }
  const au = await prisma.adminUser.findUnique({ where: { email: p.email } });
  const on = !!au?.mfaEnabled;
  const note = req.query.mfa === "on" ? `<p style="color:#15803d">Two-factor is now enabled.</p>` : req.query.mfa === "off" ? `<p style="color:#6b7280">Two-factor disabled.</p>` : "";
  const action = on
    ? `<p class="company">Two-factor authentication is <strong>on</strong> for ${esc(p.email)}.</p>
       <form method="POST" action="/admin/security/mfa/disable"><button class="btn danger" type="submit">Turn off two-factor</button></form>`
    : `<p class="company">Two-factor authentication is <strong>off</strong>. Add an authenticator app for an extra layer of protection.</p>
       <form method="POST" action="/admin/security/mfa/start"><button class="btn" type="submit">Set up two-factor</button></form>`;
  res.send(securityShell(note + action));
});

function mfaSetupView(uri: string, secret: string, qr: string, error?: string): string {
  return securityShell(
    `${error ? `<p style="color:#b91c1c">${esc(error)}</p>` : ""}
     <p class="company">Scan this with your authenticator app, then enter a code to confirm.</p>
     <p style="text-align:center"><img src="${esc(qr)}" alt="QR code" width="200" height="200" /></p>
     <p class="muted" style="text-align:center;word-break:break-all">Or enter the key manually: <code>${esc(secret)}</code></p>
     <form method="POST" action="/admin/security/mfa/enable">
       <label>Confirmation code</label>
       <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autofocus />
       <p style="margin-top:12px"><button class="btn" type="submit">Confirm &amp; enable</button></p>
     </form>`
  );
}

adminRouter.post("/security/mfa/start", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const secret = generateTotpSecret();
  await prisma.adminUser.update({ where: { email: p.email }, data: { mfaSecret: secret, mfaEnabled: false } });
  const uri = totpUri(secret, p.email);
  res.send(mfaSetupView(uri, secret, await qrDataUrl(uri, "#111827")));
});

adminRouter.post("/security/mfa/enable", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const au = await prisma.adminUser.findUnique({ where: { email: p.email } });
  if (!au?.mfaSecret || !verifyTotp(au.mfaSecret, String(req.body?.code || ""))) {
    const uri = totpUri(au?.mfaSecret || "", p.email);
    return res.status(401).send(mfaSetupView(uri, au?.mfaSecret || "", await qrDataUrl(uri, "#111827"), "Incorrect code, try again."));
  }
  await prisma.adminUser.update({ where: { email: p.email }, data: { mfaEnabled: true } });
  res.redirect("/admin/security?mfa=on");
});

adminRouter.post("/security/mfa/disable", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  await prisma.adminUser.update({ where: { email: p.email }, data: { mfaEnabled: false, mfaSecret: null } });
  res.redirect("/admin/security?mfa=off");
});

// ---------- plan & usage ----------
const LIMIT_LABELS: Record<LimitKey, string> = {
  brands: "Brands",
  locations: "Locations",
  cards: "Cards",
  admins: "Admins",
  apiKeys: "API keys",
  customDomains: "Custom domains",
};

adminRouter.get("/billing", async (req, res) => {
  const p = reqAdmin(req);
  const [planKey, usage, access, org] = await Promise.all([
    orgPlanKey(p.orgId),
    orgUsage(p.orgId),
    orgAccessState(p.orgId),
    prisma.org.findUnique({ where: { id: p.orgId }, select: { billingMode: true, stripeCustomerId: true } }),
  ]);
  const plan = planFor(planKey);
  const mode = org?.billingMode ?? "standard";
  const hasCustomer = !!org?.stripeCustomerId;

  // Self-serve Stripe checkout (only for plans that have a configured price).
  const paySection = stripeEnabled
    ? `<div style="margin-top:18px"><h3 style="margin-bottom:8px">Subscribe</h3>
         ${PLAN_ORDER.filter((k) => config.stripe.prices[k])
           .map(
             (k) =>
               `<form method="POST" action="/admin/billing/checkout" style="display:inline-block;margin:0 6px 6px 0"><input type="hidden" name="plan" value="${k}"><button class="btn" type="submit">${esc(PLANS[k].label)} — ${esc(PLANS[k].price)}</button></form>`
           )
           .join("")}
         ${hasCustomer ? `<form method="POST" action="/admin/billing/portal" style="display:inline-block"><button class="btn secondary" type="submit">Manage billing</button></form>` : ""}
       </div>`
    : `<p class="muted" style="margin-top:12px">Card checkout isn't enabled on this instance yet.</p>`;
  const rows = (Object.keys(LIMIT_LABELS) as LimitKey[])
    .map((k) => {
      const limit = plan.limits[k];
      const cap = limit < 0 ? "∞" : String(limit);
      const over = limit >= 0 && usage[k] >= limit;
      return `<tr><td>${esc(LIMIT_LABELS[k])}</td><td style="text-align:right${over ? ";color:#b91c1c;font-weight:600" : ""}">${usage[k]} / ${cap}</td></tr>`;
    })
    .join("");
  const feats = plan.features.map((f) => `<span class="pill">${esc(f)}</span>`).join(" ") || `<span class="muted">Basic features only</span>`;
  const statusColor = access.active ? "#15803d" : "#b91c1c";
  const modeLabel = mode === "free" ? "Free (comp)" : mode === "demo" ? "Demo" : "Standard";

  // Platform owners can set mode / demo length / plan by hand (comp accounts,
  // manual overrides). Paying customers use Stripe checkout (wired separately).
  const setter = p.platform
    ? `<form method="POST" action="/admin/billing/plan" style="margin-top:18px;max-width:420px">
         <label>Plan</label>
         <select name="plan">${PLAN_ORDER.map((k) => `<option value="${k}" ${k === plan.key ? "selected" : ""}>${esc(PLANS[k].label)} — ${esc(PLANS[k].price)}</option>`).join("")}</select>
         <label style="margin-top:10px">Billing mode</label>
         <select name="billingMode">
           <option value="standard" ${mode === "standard" ? "selected" : ""}>Standard (Stripe)</option>
           <option value="demo" ${mode === "demo" ? "selected" : ""}>Demo (free for a set period)</option>
           <option value="free" ${mode === "free" ? "selected" : ""}>Free (permanent comp)</option>
         </select>
         <label style="margin-top:10px">Demo length (days, demo mode only)</label>
         <select name="demoDays"><option value="30">30 days</option><option value="60">60 days</option></select>
         <p style="margin-top:10px"><button class="btn" type="submit">Update account</button></p>
       </form>`
    : `<p class="muted" style="margin-top:18px">Self-serve upgrades are coming soon. Contact us to change your plan.</p>`;
  res.send(
    page({
      title: "Plan & usage",
      body: `<main class="admin"><div class="topbar"><h2>Plan &amp; usage</h2><a class="btn secondary" href="/admin">Back</a></div>
        <p>Current plan: <strong>${esc(plan.label)}</strong> · ${esc(plan.price)} <span class="muted">(${esc(modeLabel)})</span></p>
        <p style="color:${statusColor};font-weight:600">${esc(accessSummary(access))}</p>
        <table class="usage"><tbody>${rows}</tbody></table>
        <p style="margin-top:14px">Included: ${feats}</p>
        ${paySection}
        ${setter}</main>`,
    })
  );
});

adminRouter.post("/billing/plan", async (req, res) => {
  const p = reqAdmin(req);
  // Until Stripe self-serve checkout is wired, only the platform owner assigns
  // plans / billing modes (comp accounts, demos, manual overrides).
  if (!p.platform) return forbidden(res, "Self-serve plan changes aren't available yet.");
  const b = req.body || {};
  const data: any = {};
  if (isPlanKey(String(b.plan))) data.plan = String(b.plan);
  const mode = String(b.billingMode || "");
  if (["standard", "demo", "free"].includes(mode)) {
    data.billingMode = mode;
    if (mode === "demo") {
      const days = Number(b.demoDays) === 60 ? 60 : 30;
      data.trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      data.subscriptionStatus = "trialing";
    }
  }
  if (Object.keys(data).length) await prisma.org.update({ where: { id: p.orgId }, data });
  res.redirect("/admin/billing");
});

// Start a Stripe Checkout session for a paid plan (customer enters their card on
// Stripe's hosted page — we never see it).
adminRouter.post("/billing/checkout", async (req, res) => {
  const p = reqAdmin(req);
  if (!stripeEnabled || !stripe) return res.status(503).send("Card checkout isn't configured on this instance.");
  const planKey = String(req.body?.plan || "");
  const price = config.stripe.prices[planKey];
  if (!isPlanKey(planKey) || !price) return res.redirect("/admin/billing");
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { name: true, stripeCustomerId: true } });
  let customerId = org?.stripeCustomerId || undefined;
  if (!customerId) {
    const cust = await stripe.customers.create({
      name: org?.name || undefined,
      email: p.email || undefined,
      metadata: { orgId: p.orgId },
    });
    customerId = cust.id;
    await prisma.org.update({ where: { id: p.orgId }, data: { stripeCustomerId: customerId } });
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    success_url: `${config.baseUrl}/admin/billing?checkout=success`,
    cancel_url: `${config.baseUrl}/admin/billing?checkout=cancel`,
    metadata: { orgId: p.orgId, plan: planKey },
    subscription_data: { metadata: { orgId: p.orgId, plan: planKey } },
  });
  res.redirect(303, session.url || "/admin/billing");
});

// Open the Stripe customer portal so a customer can manage/cancel their plan.
adminRouter.post("/billing/portal", async (req, res) => {
  const p = reqAdmin(req);
  if (!stripeEnabled || !stripe) return res.status(503).send("Card checkout isn't configured on this instance.");
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { stripeCustomerId: true } });
  if (!org?.stripeCustomerId) return res.redirect("/admin/billing");
  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${config.baseUrl}/admin/billing`,
  });
  res.redirect(303, session.url);
});

// ---------- brands ----------
adminRouter.get("/brands/new", async (req, res) => {
  if (!RBAC.canCreateBrand(reqAdmin(req))) return forbidden(res);
  res.send(V.brandForm(undefined, undefined, await currentTerminology()));
});
adminRouter.get("/brands/:id/edit", async (req, res) => {
  if (!RBAC.canManageBrand(reqAdmin(req), req.params.id)) return forbidden(res);
  const t = await currentTerminology();
  const brand = await prisma.brand.findUnique({
    where: { id: req.params.id },
    include: { locations: { include: { _count: { select: { cards: true } } } } },
  });
  if (!brand) return res.status(404).send("Not found");
  const stats = {
    locations: brand.locations.length,
    cards: brand.locations.reduce((sum, l) => sum + l._count.cards, 0),
  };
  res.send(V.brandForm(brand, stats, t));
});
adminRouter.post("/brands", upload.single("logoFile"), async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canCreateBrand(p)) return forbidden(res);
  if (!(await canAdd(p.orgId, "brands"))) return limitReached(res, "brand");
  const b = req.body;
  await prisma.brand.create({
    data: {
      orgId: p.orgId,
      name: b.name,
      logoUrl: uploadedUrl(req, "logoFile") || clean(b.logoUrl),
      primaryColor: b.primaryColor || "#1f6f43",
      textColor: b.textColor || "#111827",
      bgColor: b.bgColor || "#ffffff",
      font: b.font || "system",
      layout: b.layout || "classic",
      showQr: !!b.showQr,
      selfEditFields: asArray(b.selfEditFields),
      leadFields: b.leadDefault ? Prisma.DbNull : asArray(b.leadFields),
      leadConsentText: b.leadDefault ? null : clean(b.leadConsentText),
    },
  });
  res.redirect("/admin");
});
adminRouter.post("/brands/:id", upload.single("logoFile"), async (req, res) => {
  if (!RBAC.canManageBrand(reqAdmin(req), req.params.id)) return forbidden(res);
  const b = req.body;
  await prisma.brand.update({
    where: { id: req.params.id },
    data: {
      name: b.name,
      logoUrl: uploadedUrl(req, "logoFile") || clean(b.logoUrl),
      primaryColor: b.primaryColor,
      textColor: b.textColor,
      bgColor: b.bgColor,
      font: b.font || "system",
      layout: b.layout,
      showQr: !!b.showQr,
      selfEditFields: asArray(b.selfEditFields),
      leadFields: b.leadDefault ? Prisma.DbNull : asArray(b.leadFields),
      leadConsentText: b.leadDefault ? null : clean(b.leadConsentText),
    },
  });
  res.redirect("/admin");
});

// Delete a brand and everything under it. Guarded: the typed name must match
// exactly (also enforced client-side with two extra confirmations).
adminRouter.post("/brands/:id/delete", async (req, res) => {
  if (!RBAC.canDeleteBrand(reqAdmin(req))) return forbidden(res);
  const brand = await prisma.brand.findUnique({
    where: { id: req.params.id },
    include: { locations: true },
  });
  if (!brand) return res.status(404).send("Not found");

  if ((req.body?.confirmName || "") !== brand.name) {
    return res
      .status(400)
      .send(
        `The name you typed did not match "${brand.name}". The brand was NOT deleted. ` +
          `<a href="/admin/brands/${brand.id}/edit">Go back</a>.`
      );
  }

  const locationIds = brand.locations.map((l) => l.id);
  // Order matters for FK constraints: cards (cascades events/leads) -> users ->
  // templates -> locations -> brand.
  await prisma.$transaction([
    prisma.card.deleteMany({ where: { locationId: { in: locationIds } } }),
    prisma.user.deleteMany({ where: { locationId: { in: locationIds } } }),
    prisma.template.deleteMany({ where: { brandId: brand.id } }),
    prisma.location.deleteMany({ where: { brandId: brand.id } }),
    prisma.brand.delete({ where: { id: brand.id } }),
  ]);
  res.redirect("/admin");
});

// ---------- templates ----------
adminRouter.get("/templates", async (req, res) => {
  const brandId = String(req.query.brandId || "");
  if (!RBAC.canManageBrand(reqAdmin(req), brandId)) return forbidden(res);
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) return res.status(404).send("Brand not found");
  const templates = await prisma.template.findMany({ where: { brandId }, orderBy: { createdAt: "asc" } });
  res.send(V.templatesGallery(brand.name, brandId, templates));
});
adminRouter.get("/templates/new", (req, res) => {
  const brandId = String(req.query.brandId || "");
  if (!RBAC.canManageBrand(reqAdmin(req), brandId)) return forbidden(res);
  res.send(V.templateForm(brandId));
});
adminRouter.get("/templates/:id/edit", async (req, res) => {
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), tpl.brandId)) return forbidden(res);
  res.send(V.templateForm(tpl.brandId, tpl));
});

function templateData(b: any) {
  return {
    name: b.name,
    layout: b.layout || "classic",
    primaryColor: b.primaryColor || "#1f6f43",
    textColor: b.textColor || "#111827",
    bgColor: b.bgColor || "#ffffff",
    font: b.font || "system",
    isDefault: !!b.isDefault,
    // role-template behaviors
    role: clean(b.role),
    lockedFields: asArray(b.lockedFields),
    hiddenFields: asArray(b.hiddenFields),
    roleCtas: parseCtaLines(b.roleCtas),
    leadCapture: !!b.leadCapture,
    disclaimer: clean(b.disclaimer),
    showQr: b.showQr === "1" ? true : b.showQr === "0" ? false : null,
    emailSignature: clean(b.emailSignature),
    leadFields: b.leadInherit ? Prisma.DbNull : asArray(b.leadFields),
    leadConsentText: b.leadInherit ? null : clean(b.leadConsentText),
  };
}

adminRouter.post("/templates", async (req, res) => {
  const b = req.body;
  if (!RBAC.canManageBrand(reqAdmin(req), b.brandId)) return forbidden(res);
  if (b.isDefault) await prisma.template.updateMany({ where: { brandId: b.brandId }, data: { isDefault: false } });
  await prisma.template.create({ data: { brandId: b.brandId, orgId: await orgIdForBrand(b.brandId), ...templateData(b) } });
  res.redirect(`/admin/templates?brandId=${b.brandId}`);
});
adminRouter.post("/templates/:id", async (req, res) => {
  const b = req.body;
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), tpl.brandId)) return forbidden(res);
  if (b.isDefault) await prisma.template.updateMany({ where: { brandId: tpl.brandId }, data: { isDefault: false } });
  await prisma.template.update({ where: { id: req.params.id }, data: templateData(b) });
  res.redirect(`/admin/templates?brandId=${tpl.brandId}`);
});
adminRouter.post("/templates/:id/delete", async (req, res) => {
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), tpl.brandId)) return forbidden(res);
  await prisma.$transaction([
    prisma.card.updateMany({ where: { templateId: tpl.id }, data: { templateId: null } }),
    prisma.template.delete({ where: { id: tpl.id } }),
  ]);
  res.redirect(`/admin/templates?brandId=${tpl.brandId}`);
});

// ---------- locations (stores) ----------
// Dealership rooftop profile fields parsed from the location editor form.
function rooftopProfile(b: any) {
  return {
    oemBrands: parseOemBrands(b.oemBrands),
    phone: clean(b.phone),
    website: clean(b.website),
    salesUrl: clean(b.salesUrl),
    serviceUrl: clean(b.serviceUrl),
    timezone: clean(b.timezone),
    leadEmail: clean(b.leadEmail),
    campaignRouting: parseCampaignRoutingLines(b.campaignRouting),
  };
}

adminRouter.get("/locations/new", async (req, res) => {
  const brandId = String(req.query.brandId || "");
  if (!RBAC.canManageBrand(reqAdmin(req), brandId)) return forbidden(res);
  res.send(V.locationForm(brandId, undefined, await currentTerminology()));
});
adminRouter.get("/locations/:id/edit", async (req, res) => {
  const loc = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!loc) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), loc.brandId)) return forbidden(res);
  res.send(V.locationForm(loc.brandId, loc, await currentTerminology()));
});
adminRouter.post("/locations", upload.single("logoFile"), async (req, res) => {
  const p = reqAdmin(req);
  const b = req.body;
  if (!RBAC.canManageBrand(p, b.brandId)) return forbidden(res);
  if (!(await canAdd(p.orgId, "locations"))) return limitReached(res, "location");
  await prisma.location.create({
    data: {
      brandId: b.brandId,
      orgId: await orgIdForBrand(b.brandId),
      name: b.name,
      code: clean(b.code),
      logoUrl: uploadedUrl(req, "logoFile") || clean(b.logoUrl),
      primaryColor: clean(b.primaryColor),
      layout: clean(b.layout),
      address: parseAddress(b) || undefined,
      ...rooftopProfile(b),
    },
  });
  res.redirect("/admin");
});
adminRouter.post("/locations/:id", upload.single("logoFile"), async (req, res) => {
  const b = req.body;
  const loc = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!loc) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), loc.brandId)) return forbidden(res);
  await prisma.location.update({
    where: { id: req.params.id },
    data: {
      name: b.name,
      code: clean(b.code),
      logoUrl: uploadedUrl(req, "logoFile") || clean(b.logoUrl),
      primaryColor: clean(b.primaryColor),
      layout: clean(b.layout),
      address: parseAddress(b) || undefined,
      ...rooftopProfile(b),
    },
  });
  res.redirect("/admin");
});

// ---------- departments (per rooftop) ----------
async function locationForDept(id: string) {
  return prisma.location.findUnique({ where: { id }, select: { id: true, name: true, brandId: true, orgId: true } });
}

adminRouter.get("/locations/:id/departments", async (req, res) => {
  const loc = await locationForDept(req.params.id);
  if (!loc) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), loc.brandId)) return forbidden(res);
  const departments = await prisma.department.findMany({
    where: { locationId: loc.id },
    orderBy: { name: "asc" },
  });
  res.send(V.departmentsView({ location: loc, departments }));
});

adminRouter.post("/locations/:id/departments", async (req, res) => {
  const loc = await locationForDept(req.params.id);
  if (!loc) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), loc.brandId)) return forbidden(res);
  const ctas = parseCtaLines(req.body?.ctas);
  const leadEmail = clean(req.body?.leadEmail);
  const deptId = clean(req.body?.departmentId);
  if (deptId) {
    // update (name is fixed once created), scoped to this rooftop
    await prisma.department.updateMany({ where: { id: deptId, locationId: loc.id }, data: { ctas, leadEmail } });
  } else {
    const name = clean(req.body?.name);
    if (name) {
      await prisma.department.upsert({
        where: { locationId_name: { locationId: loc.id, name } },
        create: { locationId: loc.id, orgId: loc.orgId, name, ctas, leadEmail },
        update: { ctas, leadEmail },
      });
    }
  }
  res.redirect(`/admin/locations/${loc.id}/departments`);
});

adminRouter.post("/departments/:id/delete", async (req, res) => {
  const dept = await prisma.department.findUnique({
    where: { id: req.params.id },
    include: { location: { select: { id: true, brandId: true } } },
  });
  if (!dept) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), dept.location.brandId)) return forbidden(res);
  await prisma.department.delete({ where: { id: dept.id } });
  res.redirect(`/admin/locations/${dept.location.id}/departments`);
});

// ---------- assets (per rooftop) ----------
function assetDataFromBody(b: any) {
  const validTypes = ["rooftop", "department", "desk", "vehicle", "service_lane", "event", "campaign"];
  const validDest = ["url", "card", "sales", "service", "landing"];
  const type = validTypes.includes(b.type) ? b.type : "campaign";
  const destinationType = validDest.includes(b.destinationType) ? b.destinationType : "landing";
  return {
    type,
    name: clean(b.name) || assetTypeLabel(type),
    destinationType,
    destinationUrl: destinationType === "url" ? clean(b.destinationUrl) : null,
    // destinationCardId validated against the rooftop by the caller
  };
}

adminRouter.get("/locations/:id/assets", async (req, res) => {
  const loc = await locationForDept(req.params.id);
  if (!loc) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), loc.brandId)) return forbidden(res);
  const [assets, cards] = await Promise.all([
    prisma.asset.findMany({ where: { locationId: loc.id }, orderBy: { createdAt: "desc" } }),
    prisma.card.findMany({
      where: { locationId: loc.id, active: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
  ]);
  res.send(V.assetsView({ location: loc, assets, cards, cardBaseUrl: config.cardUrl }));
});

adminRouter.post("/locations/:id/assets", async (req, res) => {
  const loc = await locationForDept(req.params.id);
  if (!loc) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), loc.brandId)) return forbidden(res);
  const data = assetDataFromBody(req.body);
  // Resolve + validate the destination card against this rooftop.
  let destinationCardId: string | null = null;
  if (data.destinationType === "card") {
    const cid = clean(req.body?.destinationCardId);
    if (cid) {
      const ok = await prisma.card.count({ where: { id: cid, locationId: loc.id } });
      if (ok) destinationCardId = cid;
    }
  }
  const assetId = clean(req.body?.assetId);
  if (assetId) {
    await prisma.asset.updateMany({
      where: { id: assetId, locationId: loc.id },
      data: { ...data, destinationCardId },
    });
  } else {
    const slug = await uniqueAssetSlug(data.name);
    await prisma.asset.create({
      data: { ...data, destinationCardId, orgId: loc.orgId, locationId: loc.id, slug },
    });
  }
  res.redirect(`/admin/locations/${loc.id}/assets`);
});

adminRouter.post("/assets/:id/delete", async (req, res) => {
  const asset = await prisma.asset.findUnique({
    where: { id: req.params.id },
    include: { location: { select: { id: true, brandId: true } } },
  });
  if (!asset) return res.status(404).send("Not found");
  if (!RBAC.canManageBrand(reqAdmin(req), asset.location.brandId)) return forbidden(res);
  await prisma.asset.delete({ where: { id: asset.id } });
  res.redirect(`/admin/locations/${asset.location.id}/assets`);
});

// ---------- cards ----------
adminRouter.get("/cards", async (req, res) => {
  const t = await currentTerminology();
  const locationId = String(req.query.locationId || "");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), locationId))) return forbidden(res);
  const loc = await prisma.location.findUnique({ where: { id: locationId } });
  if (!loc) return res.status(404).send(`${t.locationSingular} not found`);
  const cards = await prisma.card.findMany({
    where: { locationId },
    orderBy: { lastName: "asc" },
  });
  res.send(V.cardList(loc.name, locationId, cards, t));
});

function brandFields(brand: { selfEditFields: unknown } | null): string[] | undefined {
  return brand && Array.isArray(brand.selfEditFields) ? (brand.selfEditFields as string[]) : undefined;
}

adminRouter.get("/cards/new", async (req, res) => {
  const t = await currentTerminology();
  const locationId = String(req.query.locationId || "");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), locationId))) return forbidden(res);
  const loc = await prisma.location.findUnique({
    where: { id: locationId },
    include: { brand: true },
  });
  if (!loc) return res.status(404).send(`${t.locationSingular} not found`);
  const templates = await prisma.template.findMany({ where: { brandId: loc.brandId } });
  const departments = await prisma.department.findMany({ where: { locationId }, orderBy: { name: "asc" } });
  res.send(V.cardForm({ locationId, templates, departments, brandSelfFields: brandFields(loc.brand), terminology: t }));
});

adminRouter.get("/cards/:id/edit", async (req, res) => {
  const t = await currentTerminology();
  const card = await prisma.card.findUnique({
    where: { id: req.params.id },
    include: { location: { include: { brand: true } } },
  });
  if (!card) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);
  const templates = await prisma.template.findMany({ where: { brandId: card.location.brandId } });
  const departments = await prisma.department.findMany({
    where: { locationId: card.locationId },
    orderBy: { name: "asc" },
  });
  res.send(
    V.cardForm({
      card,
      locationId: card.locationId,
      templates,
      departments,
      brandSelfFields: brandFields(card.location.brand),
      terminology: t,
    })
  );
});

async function allowedTemplateId(templateId: string | null, brandId: string): Promise<string | null> {
  if (!templateId) return null;
  const count = await prisma.template.count({ where: { id: templateId, brandId } });
  return count ? templateId : null;
}

function cardDataFromBody(b: any, templateId: string | null) {
  return {
    prefix: clean(b.prefix),
    firstName: b.firstName,
    lastName: b.lastName,
    pronouns: clean(b.pronouns),
    title: clean(b.title),
    department: clean(b.department),
    company: clean(b.company),
    bio: clean(b.bio),
    photoUrl: clean(b.photoUrl),
    phones: parseLabeled(b.phones),
    emails: parseLabeled(b.emails),
    websites: parseLabeled(b.websites),
    socials: parseSocials(b.socials),
    address: parseAddress(b) || undefined,
    templateId,
    layout: clean(b.layout),
    primaryColor: clean(b.primaryColor),
    logoUrl: clean(b.logoUrl),
    ownerEmail: clean(b.ownerEmail),
    showQr: b.showQr === "1" ? true : b.showQr === "0" ? false : null,
    // selfInherit checked => inherit brand policy (store SQL NULL); else store the chosen list.
    selfEditFields: b.selfInherit ? Prisma.DbNull : asArray(b.selfEditFields),
  };
}

const cardUploads = upload.fields([
  { name: "photoFile", maxCount: 1 },
  { name: "logoFile", maxCount: 1 },
]);

// Overlay uploaded files onto the parsed card data (uploads win over URL fields).
function withCardUploads(req: any) {
  const data = cardDataFromBody(req.body, null);
  const photo = uploadedUrl(req, "photoFile");
  const logo = uploadedUrl(req, "logoFile");
  if (photo) data.photoUrl = photo;
  if (logo) data.logoUrl = logo;
  return data;
}

// Resolve the chosen department (validated against the card's rooftop) onto the
// card data: sets departmentId and the display `department` string to its name.
async function applyDepartment(data: any, b: any, locationId: string) {
  const deptId = clean(b.departmentId);
  if (deptId) {
    const d = await prisma.department.findFirst({ where: { id: deptId, locationId } });
    if (d) {
      data.departmentId = d.id;
      data.department = d.name;
      return;
    }
  }
  data.departmentId = null; // keeps any free-text `department` fallback from the form
}

adminRouter.post("/cards", cardUploads, async (req, res) => {
  const p = reqAdmin(req);
  const b = req.body;
  if (!(await RBAC.canAccessLocation(p, b.locationId))) return forbidden(res);
  if (!(await canAdd(p.orgId, "cards"))) return limitReached(res, "card");
  const loc = await prisma.location.findUnique({ where: { id: b.locationId } });
  if (!loc) return res.status(404).send("Location not found");
  const slug = await uniqueSlug(b.firstName, b.lastName);
  const data = withCardUploads(req);
  data.templateId = await allowedTemplateId(clean(b.templateId), loc.brandId);
  await applyDepartment(data, b, b.locationId);
  const card = await prisma.card.create({
    data: { locationId: b.locationId, orgId: loc.orgId, slug, ...data },
  });
  emitEvent("card.created", cardPayload(card));
  res.redirect(`/admin/cards?locationId=${b.locationId}`);
});

adminRouter.post("/cards/:id", cardUploads, async (req, res) => {
  const b = req.body;
  const existing = await prisma.card.findUnique({
    where: { id: req.params.id },
    include: { location: true },
  });
  if (!existing) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), existing.locationId))) return forbidden(res);
  const data = withCardUploads(req);
  data.templateId = await allowedTemplateId(clean(b.templateId), existing.location.brandId);
  await applyDepartment(data, b, existing.locationId);
  const card = await prisma.card.update({ where: { id: req.params.id }, data });
  emitEvent("card.updated", cardPayload(card));
  res.redirect(`/admin/cards?locationId=${existing.locationId}`);
});

adminRouter.post("/cards/:id/delete", async (req, res) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (card && !(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);
  await prisma.card.delete({ where: { id: req.params.id } });
  if (card) emitEvent("card.deleted", { id: card.id, slug: card.slug });
  res.redirect(`/admin/cards?locationId=${card?.locationId || ""}`);
});

// ---------- email signature ----------
adminRouter.get("/cards/:id/signature", async (req, res) => {
  const card = await prisma.card.findUnique({
    where: { id: req.params.id },
    include: { location: { include: { brand: true } }, template: true, dept: true },
  });
  if (!card) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);
  const dealer = mergeCtas(
    mergeCtas(ctasFromJson((card.dept as any)?.ctas), ctasFromJson((card.template as any)?.roleCtas)),
    rooftopCtas(card.location as any)
  );
  const ctas = dealer.slice(0, 2).map((c) => ({ label: c.label, href: c.href }));
  const model = buildSignatureModel(card, { cardBaseUrl: config.cardUrl, ctas });
  const block = signatureBlock(renderSignatureHtml(model), renderSignatureText(model));
  res.send(V.signaturePreviewView([card.firstName, card.lastName].filter(Boolean).join(" "), card.id, block));
});

// ---------- turnover / offboarding ----------
adminRouter.get("/cards/:id/turnover", async (req, res) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id }, include: { location: true } });
  if (!card) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);
  const [otherCards, leadCount] = await Promise.all([
    prisma.card.findMany({
      where: { locationId: card.locationId, active: true, id: { not: card.id } },
      select: { id: true, slug: true, firstName: true, lastName: true, title: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.lead.count({ where: { cardId: card.id } }),
  ]);
  res.send(V.turnoverForm({ card, rooftop: card.location, otherCards, leadCount }));
});

adminRouter.post("/cards/:id/turnover", async (req, res) => {
  const b = req.body;
  const card = await prisma.card.findUnique({ where: { id: req.params.id }, include: { location: true } });
  if (!card) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);

  // Redirect target: validate a card:<slug> choice against an active card in this rooftop.
  let choice = clean(b.redirect) || "none";
  if (choice.startsWith("card:")) {
    const ok = await prisma.card.count({
      where: { slug: choice.slice(5), locationId: card.locationId, active: true },
    });
    if (!ok) choice = "none";
  }
  const redirectUrl = redirectTargetUrl(choice, {
    cardBaseUrl: config.cardUrl,
    rooftopWebsite: card.location.website,
  });

  // Transfer leads to another card in the rooftop (validated), or keep them.
  const transfer = clean(b.transferLeads);
  if (transfer && transfer !== "keep") {
    const target = await prisma.card.findFirst({
      where: { id: transfer, locationId: card.locationId },
      select: { id: true },
    });
    if (target) await prisma.lead.updateMany({ where: { cardId: card.id }, data: { cardId: target.id } });
  }

  // Offboard: disable the public card, revoke self-service, set the redirect.
  await prisma.card.update({ where: { id: card.id }, data: offboardCardUpdate(redirectUrl) });

  // Optional replacement: clone role/design/placement, assign the new hire.
  if (b.createReplacement) {
    const first = clean(b.newFirstName);
    const last = clean(b.newLastName);
    if (first || last) {
      const data: any = replacementCardData(card);
      if (data.selfEditFields == null) delete data.selfEditFields;
      const slug = await uniqueSlug(first || "new", last || "hire");
      const replacement = await prisma.card.create({
        data: {
          orgId: card.orgId,
          slug,
          firstName: first || "New",
          lastName: last || "Hire",
          ownerEmail: clean(b.newOwnerEmail),
          ...data,
        },
      });
      emitEvent("card.created", cardPayload(replacement));
    }
  }

  res.redirect(`/admin/cards?locationId=${card.locationId}`);
});

// Card ids the principal may see (null = no restriction, i.e. global admin).
async function accessibleCardIds(p: RBAC.AdminPrincipal): Promise<string[] | null> {
  if (p.global) return null;
  const locIds = await RBAC.accessibleLocationIds(p);
  const cards = await prisma.card.findMany({ where: { locationId: { in: locIds } }, select: { id: true } });
  return cards.map((c) => c.id);
}

// ---------- analytics ----------
adminRouter.get("/cards/:id/analytics", async (req, res) => {
  const target = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), target.locationId))) return forbidden(res);
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ["type"],
    where: { cardId: req.params.id },
    _count: { _all: true },
  });
  const totals: Record<string, number> = {};
  grouped.forEach((g) => (totals[g.type] = g._count._all));
  res.send(
    V.analyticsView({
      totals,
      topCards: [{ name: `${target.firstName} ${target.lastName}`, slug: target.slug, views: totals.view || 0 }],
    })
  );
});

adminRouter.get("/analytics", async (req, res) => {
  const ids = await accessibleCardIds(reqAdmin(req));
  const cf = ids ? { cardId: { in: ids } } : {};
  const grouped = await prisma.analyticsEvent.groupBy({ by: ["type"], where: cf, _count: { _all: true } });
  const totals: Record<string, number> = {};
  grouped.forEach((g) => (totals[g.type] = g._count._all));

  const views = await prisma.analyticsEvent.groupBy({
    by: ["cardId"],
    where: { type: "view", ...cf },
    _count: { _all: true },
    orderBy: { _count: { cardId: "desc" } },
    take: 10,
  });
  const cards = await prisma.card.findMany({ where: { id: { in: views.map((v) => v.cardId) } } });
  const byId = new Map(cards.map((c) => [c.id, c]));
  const topCards = views.map((v) => {
    const c = byId.get(v.cardId);
    return { name: c ? `${c.firstName} ${c.lastName}` : "—", slug: c?.slug || "", views: v._count._all };
  });
  res.send(V.analyticsView({ totals, topCards }));
});

// ---------- leads ----------
// Scope leads to what the admin may see: cards in their locations OR assets in
// their locations (global admins see all).
async function leadScopeWhere(p: RBAC.AdminPrincipal) {
  const cardIds = await accessibleCardIds(p);
  if (cardIds === null) return {};
  const locIds = await RBAC.accessibleLocationIds(p);
  const assets = await prisma.asset.findMany({ where: { locationId: { in: locIds } }, select: { id: true } });
  return { OR: [{ cardId: { in: cardIds } }, { assetId: { in: assets.map((a) => a.id) } }] };
}

function leadStatusFilter(req: any): string {
  const s = String(req.query.status || "");
  return (LEAD_STATUSES as readonly string[]).includes(s) ? s : "";
}

adminRouter.get("/leads", async (req, res) => {
  const status = leadStatusFilter(req);
  const scope = await leadScopeWhere(reqAdmin(req));
  const leads = await prisma.lead.findMany({
    where: { ...scope, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: { card: true, asset: true },
    take: 500,
  });
  res.send(V.leadsView(leads, status));
});

// Lead detail + lifecycle history.
adminRouter.get("/leads/:id", async (req, res) => {
  const lead = await prisma.lead.findFirst({
    where: { id: req.params.id, ...(await leadScopeWhere(reqAdmin(req))) },
    include: { card: true, asset: true },
  });
  if (!lead) return res.status(404).send("Lead not found");
  const events = await prisma.leadEvent.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" } });
  res.send(V.leadDetailView({ lead, events }));
});

async function scopedLead(req: any, id: string) {
  return prisma.lead.findFirst({ where: { id, ...(await leadScopeWhere(reqAdmin(req))) } });
}

adminRouter.post("/leads/:id/status", async (req, res) => {
  const p = reqAdmin(req);
  const lead = await scopedLead(req, req.params.id);
  if (!lead) return res.status(404).send("Not found");
  const to = clean(req.body?.status) || "";
  if (!canTransition(lead.status, to)) return res.status(400).send("Invalid status transition.");
  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: { status: to } }),
    prisma.leadEvent.create({
      data: { leadId: lead.id, orgId: lead.orgId, type: "status", fromValue: lead.status, toValue: to, actor: p.email || "admin" },
    }),
  ]);
  res.redirect(`/admin/leads/${lead.id}`);
});

adminRouter.post("/leads/:id/assign", async (req, res) => {
  const p = reqAdmin(req);
  const lead = await scopedLead(req, req.params.id);
  if (!lead) return res.status(404).send("Not found");
  const to = clean(req.body?.assignedTo);
  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: { assignedTo: to } }),
    prisma.leadEvent.create({
      data: { leadId: lead.id, orgId: lead.orgId, type: "assign", fromValue: lead.assignedTo, toValue: to, actor: p.email || "admin" },
    }),
  ]);
  res.redirect(`/admin/leads/${lead.id}`);
});

adminRouter.post("/leads/:id/note", async (req, res) => {
  const p = reqAdmin(req);
  const lead = await scopedLead(req, req.params.id);
  if (!lead) return res.status(404).send("Not found");
  const note = clean(req.body?.note);
  if (note) {
    await prisma.leadEvent.create({
      data: { leadId: lead.id, orgId: lead.orgId, type: "note", note, actor: p.email || "admin" },
    });
  }
  res.redirect(`/admin/leads/${lead.id}`);
});

adminRouter.get("/leads.csv", async (req, res) => {
  const status = leadStatusFilter(req);
  const scope = await leadScopeWhere(reqAdmin(req));
  const leads = await prisma.lead.findMany({
    where: { ...scope, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: { card: true, asset: true },
  });
  const rows = [
    [
      "created", "name", "email", "phone", "company", "note",
      "preferred_contact", "vehicle_interest", "trade_in", "service_need", "appointment", "consent",
      "status", "assigned_to", "duplicate_of", "campaign", "utm_source", "utm_medium", "utm_campaign", "referrer", "device",
      "from_card", "department",
    ],
    ...leads.map((l) => [
      new Date(l.createdAt).toISOString(),
      l.name,
      l.email || "",
      l.phone || "",
      l.company || "",
      (l.note || "").replace(/\n/g, " "),
      l.preferredContact || "",
      l.vehicleInterest || "",
      l.tradeIn ? "yes" : "",
      l.serviceNeed || "",
      l.appointmentRequest ? "yes" : "",
      l.consent ? "yes" : "",
      l.status || "new",
      l.assignedTo || "",
      l.duplicateOfId || "",
      l.campaign || "",
      l.utmSource || "",
      l.utmMedium || "",
      l.utmCampaign || "",
      l.referrer || "",
      l.device || "",
      l.card ? `${l.card.firstName} ${l.card.lastName}` : l.asset ? `${l.asset.name} (asset)` : "",
      l.card?.department || "",
    ]),
  ];
  const csv = rows.map((r) => r.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
  res.send(csv);
});

// ---------- integrations: API keys + webhooks + SCIM ----------
// API keys and webhooks are per-org; only platform owners see across orgs.
async function renderIntegrations(res: any, p: RBAC.AdminPrincipal, newKey: string | null = null, newScimToken: string | null = null) {
  const orgFilter = p.platform ? {} : { orgId: p.orgId };
  const [keys, endpoints, saml, org] = await Promise.all([
    prisma.apiKey.findMany({ where: orgFilter, orderBy: { createdAt: "desc" } }),
    prisma.webhookEndpoint.findMany({
      where: orgFilter,
      orderBy: { createdAt: "desc" },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    getSamlConfigForOrg(p.orgId),
    prisma.org.findUnique({
      where: { id: p.orgId },
      select: { scimTokenHash: true, subdomain: true, customDomain: true },
    }),
  ]);
  const samlHost = org ? orgCanonicalHost(org) : null;
  res.send(
    V.integrationsView({
      keys,
      endpoints,
      events: WEBHOOK_EVENTS,
      newKey,
      baseUrl: config.baseUrl,
      saml,
      samlIssuer: samlHost ? samlSpIssuer(samlHost) : "",
      samlAcsUrl: samlHost ? samlAcsUrl(samlHost) : "",
      samlHost,
      subdomain: org?.subdomain ?? null,
      customDomain: org?.customDomain ?? null,
      platformDomain: process.env.PLATFORM_DOMAIN || "",
      scimBaseUrl: `${config.baseUrl}/scim/v2`,
      scimTokenSet: !!org?.scimTokenHash,
      newScimToken,
    })
  );
}

adminRouter.get("/integrations", (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  return renderIntegrations(res, p);
});

adminRouter.post("/api-keys", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  if (!(await ensureFeature(res, p.orgId, "api", "API access"))) return;
  if (!(await canAdd(p.orgId, "apiKeys"))) return limitReached(res, "API key");
  const name = clean(req.body?.name) || "API key";
  const scopes = sanitizeScopes(asArray(req.body?.scopes));
  const { raw, hash, prefix } = generateApiKey();
  await prisma.apiKey.create({ data: { name, keyHash: hash, prefix, orgId: p.orgId, scopes } });
  // Render directly (not a redirect) so the raw key never lands in a URL/log.
  await renderIntegrations(res, p, raw);
});

adminRouter.post("/api-keys/:id/revoke", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  // updateMany scoped by org so an admin can't revoke another org's key.
  await prisma.apiKey.updateMany({
    where: p.platform ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
    data: { revoked: true },
  });
  res.redirect("/admin/integrations");
});

adminRouter.post("/webhooks", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  if (!(await ensureFeature(res, p.orgId, "webhooks", "Webhooks"))) return;
  const url = clean(req.body?.url);
  if (!url) return res.redirect("/admin/integrations");
  const events = asArray(req.body?.events).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  const secret = "whsec_" + crypto.randomBytes(24).toString("hex");
  await prisma.webhookEndpoint.create({
    data: { url, secret, events: events.length ? events : ["lead.captured"], orgId: p.orgId },
  });
  res.redirect("/admin/integrations");
});

adminRouter.post("/webhooks/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await prisma.webhookEndpoint.deleteMany({
    where: p.platform ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
  });
  res.redirect("/admin/integrations");
});

// Delivery inspector for one endpoint (org-scoped).
adminRouter.get("/webhooks/:id", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: p.platform ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
  });
  if (!endpoint) return res.status(404).send("Webhook not found.");
  const filter = req.query.filter === "failed" ? "failed" : "all";
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpointId: endpoint.id, ...(filter === "failed" ? { success: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const flash =
    req.query.sent === "1" ? "Test event sent." : req.query.replayed === "1" ? "Delivery replayed." : null;
  res.send(V.webhookDetailView({ endpoint, deliveries, filter, flash }));
});

adminRouter.post("/webhooks/:id/test", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await sendTestEvent(req.params.id, p.orgId);
  res.redirect(`/admin/webhooks/${req.params.id}?sent=1`);
});

adminRouter.post("/deliveries/:id/replay", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const d = await prisma.webhookDelivery.findFirst({
    where: p.platform ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
    select: { endpointId: true, orgId: true },
  });
  if (!d) return res.status(404).send("Delivery not found.");
  await replayDelivery(req.params.id, d.orgId);
  res.redirect(`/admin/webhooks/${d.endpointId}?replayed=1`);
});

adminRouter.post("/scim-token/generate", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  if (!(await ensureFeature(res, p.orgId, "scim", "SCIM provisioning"))) return;
  const { raw, hash } = generateScimToken();
  await prisma.org.update({ where: { id: p.orgId }, data: { scimTokenHash: hash } });
  // Show the raw token once (never stored in plaintext / never in a URL).
  await renderIntegrations(res, p, null, raw);
});

adminRouter.post("/saml-config", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const enabled = !!req.body?.enabled;
  // Turning SSO on requires a plan that includes it.
  if (enabled && !(await ensureFeature(res, p.orgId, "sso", "Single sign-on (SAML)"))) return;
  const entryPoint = clean(req.body?.entryPoint);
  const idpIssuer = clean(req.body?.idpIssuer);
  const idpCert = clean(req.body?.idpCert);
  if (enabled && (!entryPoint || !idpCert)) {
    return res.status(400).send("SAML sign-in needs an IdP SSO URL and signing certificate before it can be enabled.");
  }

  // Workspace address (needed for a stable ACS/reply URL). Normalize + validate.
  const subRaw = (clean(req.body?.subdomain) || "").toLowerCase();
  const subdomain = subRaw ? subRaw.replace(/[^a-z0-9-]/g, "") : null;
  if (subRaw && (!subdomain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(subdomain))) {
    return res.status(400).send("Subdomain may contain only letters, numbers and hyphens.");
  }
  const customDomain =
    (clean(req.body?.customDomain) || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;

  try {
    // Address is org-level; scoped to this admin's org.
    await prisma.org.update({ where: { id: p.orgId }, data: { subdomain, customDomain } });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return res.status(409).send("That subdomain or custom domain is already taken by another workspace.");
    }
    throw e;
  }

  await prisma.samlConfig.upsert({
    where: { orgId: p.orgId },
    create: { orgId: p.orgId, enabled, entryPoint, idpIssuer, idpCert },
    update: { enabled, entryPoint, idpIssuer, idpCert },
  });
  res.redirect("/admin/integrations");
});

// ---------- admin accounts (org owner / platform only) ----------
// Admins are per-org: an org owner only sees/manages admins in their own org and
// can only scope them to their own org's brands/rooftops. Platform owners span all.

// Confirm the target admin is one this principal may manage; returns it or null.
async function manageableAdmin(p: RBAC.AdminPrincipal, id: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id }, include: { scopes: true } });
  if (!admin) return null;
  if (!p.platform && admin.orgId !== p.orgId) return null;
  return admin;
}

adminRouter.get("/admins", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const admins = await prisma.adminUser.findMany({
    where: p.platform ? {} : { orgId: p.orgId },
    orderBy: { createdAt: "asc" },
    include: { scopes: true },
  });
  res.send(V.adminsView(admins));
});
adminRouter.get("/admins/new", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const orgFilter = p.platform ? {} : { orgId: p.orgId };
  const [brands, locations] = await Promise.all([
    prisma.brand.findMany({ where: orgFilter, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: orgFilter, orderBy: { name: "asc" }, include: { brand: true } }),
  ]);
  res.send(V.adminForm({ brands, locations }));
});
adminRouter.get("/admins/:id/edit", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const admin = await manageableAdmin(p, req.params.id);
  if (!admin) return res.status(404).send("Not found");
  const orgFilter = p.platform ? {} : { orgId: p.orgId };
  const [brands, locations] = await Promise.all([
    prisma.brand.findMany({ where: orgFilter, orderBy: { name: "asc" } }),
    prisma.location.findMany({ where: orgFilter, orderBy: { name: "asc" }, include: { brand: true } }),
  ]);
  res.send(V.adminForm({ admin, brands, locations }));
});

function scopeRowsFromBody(b: any): { brandId?: string; locationId?: string }[] {
  const rows: { brandId?: string; locationId?: string }[] = [];
  if (b.role === "brand_admin") for (const id of asArray(b.brandScope)) rows.push({ brandId: id });
  if (b.role === "location_admin") for (const id of asArray(b.locationScope)) rows.push({ locationId: id });
  return rows;
}

// Non-platform admins can only assign org-level roles, never platform_owner.
function safeRole(p: RBAC.AdminPrincipal, role: string): string {
  if (!p.platform && (role === "platform_owner" || role === "super_admin")) return "org_admin";
  return role;
}

adminRouter.post("/admins", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const b = req.body;
  const email = String(b.email || "").toLowerCase().trim();
  if (!email || !b.role) return res.redirect("/admin/admins/new");
  if (!(await canAdd(p.orgId, "admins"))) return limitReached(res, "admin");
  const data: any = {
    email,
    name: clean(b.name),
    role: safeRole(p, b.role),
    orgId: p.orgId,
    scopes: { create: scopeRowsFromBody(b) },
  };
  if (b.password) data.passwordHash = hashPassword(String(b.password));
  await prisma.adminUser.create({ data });
  res.redirect("/admin/admins");
});

adminRouter.post("/admins/:id", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const target = await manageableAdmin(p, req.params.id);
  if (!target) return res.status(404).send("Not found");
  const b = req.body;
  const data: any = { name: clean(b.name), role: safeRole(p, b.role), active: !!b.active };
  if (b.password) data.passwordHash = hashPassword(String(b.password));
  if (b.resetMfa) {
    data.mfaEnabled = false;
    data.mfaSecret = null;
  }
  await prisma.$transaction([
    prisma.adminScope.deleteMany({ where: { adminUserId: target.id } }),
    prisma.adminUser.update({
      where: { id: target.id },
      data: { ...data, scopes: { create: scopeRowsFromBody(b) } },
    }),
  ]);
  res.redirect("/admin/admins");
});

adminRouter.post("/admins/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const target = await manageableAdmin(p, req.params.id);
  if (!target) return res.status(404).send("Not found");
  await prisma.adminUser.delete({ where: { id: target.id } });
  res.redirect("/admin/admins");
});

// Friendly handling for upload errors (wrong type / too large) — instead of a
// silent fallback or a 500, tell the admin what went wrong.
adminRouter.use((err: any, _req: any, res: any, _next: any) => {
  const msg =
    err?.code === "LIMIT_FILE_SIZE"
      ? "That image is too large (max 5 MB)."
      : err?.message || "Something went wrong with the upload.";
  res.status(400).send(
    page({
      title: "Upload error",
      body: `<main class="card"><section class="ident"><h1>Upload problem</h1><p class="company">${esc(
        msg
      )}</p></section><a class="cta" href="javascript:history.back()">Go back and try another image</a></main>`,
    })
  );
});
