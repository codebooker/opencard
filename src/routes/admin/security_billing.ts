// Admin route group: security_billing (split from admin.ts, CQ-05).
import {
  Router, LimitKey, PLANS, PLAN_ORDER, Prisma, SESSION_COOKIE, accessSummary, audit,
  config, esc, findSession, forbidden, generateRecoveryCodes, generateTotpSecret, hashRecoveryCodes, isPlanKey,
  issueToken, listSessions, orgAccessState, orgPlanKey, orgUsage, page, planFor, prisma,
  qrDataUrl, recoveryCodeCount, reqAdmin, revokeAllSessions, revokeSession, sendMail, stripe, stripeEnabled,
  totpUri, verifyTotp,
} from "./context";
import { V } from "./context";

export function registerSecurityBillingRoutes(router: Router) {
  const adminRouter = router;

// ---------- security (per-account two-factor) ----------
adminRouter.get("/security", async (req, res) => {
  const p = reqAdmin(req);
  const note =
    req.query.mfa === "on"
      ? `<p style="color:#15803d">Two-factor is now enabled.</p>`
      : req.query.mfa === "off"
      ? `<p class="muted">Two-factor disabled.</p>`
      : req.query.mfa === "required"
      ? `<p style="color:#b45309"><strong>Two-factor is required for OpenCard staff accounts.</strong> Enable it below to continue.</p>`
      : "";
  const workspace = p.platform
    ? null
    : (await prisma.org.findUnique({ where: { id: p.orgId }, select: { name: true } }))?.name || null;
  if (!p.email) return res.send(V.securityView({ email: null, on: false, note, workspace, platform: p.platform }));
  const au = await prisma.adminUser.findUnique({ where: { email: p.email } });
  const current = await findSession(req.cookies?.[SESSION_COOKIE]);
  const sessions = au ? await listSessions(au.id) : [];
  res.send(
    V.securityView({
      email: p.email,
      on: !!au?.mfaEnabled,
      note,
      workspace,
      platform: p.platform,
      recoveryCount: recoveryCodeCount(au?.recoveryCodes),
      sessions: sessions.map((s) => ({
        id: s.id,
        current: s.id === current?.id,
        lastSeenAt: s.lastSeenAt,
        createdAt: s.createdAt,
        ip: s.ip,
        userAgent: s.userAgent,
      })),
    })
  );
});

adminRouter.post("/security/mfa/start", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const secret = generateTotpSecret();
  await prisma.adminUser.update({ where: { email: p.email }, data: { mfaSecret: secret, mfaEnabled: false } });
  const uri = totpUri(secret, p.email);
  res.send(V.mfaSetupView(await qrDataUrl(uri, "#111827"), secret));
});

adminRouter.post("/security/mfa/enable", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const au = await prisma.adminUser.findUnique({ where: { email: p.email } });
  if (!au?.mfaSecret || !verifyTotp(au.mfaSecret, String(req.body?.code || ""))) {
    return res.status(401).send(V.mfaSetupView(await qrDataUrl(totpUri(au?.mfaSecret || "", p.email), "#111827"), au?.mfaSecret || "", "Incorrect code, try again."));
  }
  // Enable MFA and hand out single-use recovery codes (shown exactly once).
  const codes = generateRecoveryCodes();
  await prisma.adminUser.update({
    where: { email: p.email },
    data: { mfaEnabled: true, recoveryCodes: hashRecoveryCodes(codes) },
  });
  audit(req, p, "security.mfa_enabled", { targetType: "AdminUser", summary: p.email });
  res.send(V.recoveryCodesView(codes, "Two-factor is on. Save these recovery codes now — they're shown only once."));
});

adminRouter.post("/security/recovery/regenerate", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const au = await prisma.adminUser.findUnique({ where: { email: p.email }, select: { mfaEnabled: true } });
  if (!au?.mfaEnabled) return res.redirect("/admin/security");
  const codes = generateRecoveryCodes();
  await prisma.adminUser.update({ where: { email: p.email }, data: { recoveryCodes: hashRecoveryCodes(codes) } });
  audit(req, p, "security.recovery_regenerated", { targetType: "AdminUser", summary: p.email });
  res.send(V.recoveryCodesView(codes, "New recovery codes. Your previous codes no longer work."));
});

adminRouter.post("/security/sessions/:id/revoke", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const au = await prisma.adminUser.findUnique({ where: { email: p.email }, select: { id: true } });
  if (au) await revokeSession(req.params.id, au.id);
  res.redirect("/admin/security");
});

adminRouter.post("/security/sessions/revoke-others", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const au = await prisma.adminUser.findUnique({ where: { email: p.email }, select: { id: true } });
  const current = await findSession(req.cookies?.[SESSION_COOKIE]);
  if (au) await revokeAllSessions(au.id, current?.id);
  res.redirect("/admin/security");
});

adminRouter.post("/verify/resend", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  const raw = await issueToken("verify", p.email, p.orgId);
  await sendMail(
    [p.email],
    "Verify your OpenCard email",
    `Confirm your email to take your OpenCard workspace live (link expires in 7 days):\n` +
      `${config.baseUrl}/admin/verify?token=${raw}`
  );
  res.redirect("/admin?verify=sent");
});

adminRouter.post("/security/mfa/disable", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.email) return forbidden(res);
  // Platform (staff) accounts must keep MFA on — disabling would just bounce
  // them into the enrollment gate on the next request.
  if (p.platform) return forbidden(res, "Two-factor is required for OpenCard staff accounts and can't be disabled.");
  await prisma.adminUser.update({ where: { email: p.email }, data: { mfaEnabled: false, mfaSecret: null, recoveryCodes: Prisma.DbNull } });
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
  const modeLabel = mode === "free" ? "Free (comp)" : mode === "demo" ? "Demo" : "Standard";

  // Platform staff can set mode / demo length / plan by hand (comp accounts,
  // manual overrides). Paying customers use Stripe checkout (wired separately).
  const staffSetter = p.platform
    ? `<form class="editor" method="POST" action="/admin/billing/plan" style="max-width:420px">
         <label>Plan</label>
         <select name="plan">${PLAN_ORDER.map((k) => `<option value="${k}" ${k === plan.key ? "selected" : ""}>${esc(PLANS[k].label)} — ${esc(PLANS[k].price)}</option>`).join("")}</select>
         <label style="margin-top:10px">Billing mode</label>
         <select name="billingMode" id="staff-billing-mode">
           <option value="standard" ${mode === "standard" ? "selected" : ""}>Standard (Stripe)</option>
           <option value="demo" ${mode === "demo" ? "selected" : ""}>Demo (free for a set period)</option>
           <option value="free" ${mode === "free" ? "selected" : ""}>Free (permanent comp)</option>
         </select>
         <div id="staff-demo-days" style="display:none">
           <label style="margin-top:10px">Demo length</label>
           <select name="demoDays"><option value="30">30 days</option><option value="60">60 days</option></select>
         </div>
         <p style="margin-top:10px"><button class="btn" type="submit">Update account</button></p>
       </form>
       <script>(function(){
         var m=document.getElementById('staff-billing-mode'),w=document.getElementById('staff-demo-days');
         if(!m||!w) return;
         function u(){ w.style.display = m.value==='demo' ? '' : 'none'; }
         m.addEventListener('change',u); u();
       })();</script>`
    : null;
  res.send(
    V.billingView({
      plan: { key: plan.key, label: plan.label, price: plan.price, features: plan.features },
      modeLabel,
      statusLine: accessSummary(access),
      statusOk: access.active,
      usageRows: rows,
      paySection,
      staffSetter,
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
  if (Object.keys(data).length) {
    await prisma.org.update({ where: { id: p.orgId }, data });
    audit(req, p, "billing.plan", { targetType: "Org", targetId: p.orgId, summary: JSON.stringify(data) });
  }
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

}
