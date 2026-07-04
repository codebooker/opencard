import { Router } from "express";
import { prisma, runWithOrg } from "../db";
import { config } from "../config";
import { hashPassword } from "../security";
import { getPlatformConfig } from "../platform-config";
import { issueToken, peekToken, consumeToken } from "../account";
import { sendMail } from "../notify";
import { mailEnabled } from "../config";
import { VERTICALS, isVertical } from "../terminology";
import { page, esc } from "../views/html";

// Public self-service onboarding, magic-link first (BetterStack-style):
//   1) /signup asks only for an email and sends a single-use link.
//   2) /signup/complete?token=... (from the email) shows the real form.
//   3) Completing it creates the org ALREADY verified — no junk orgs from
//      typo'd addresses, and nobody can squat an email they don't own.
// Instances without SMTP fall back to the classic one-form flow (the link
// could never arrive), with the org auto-verified as before.
export const signupRouter = Router();

const clean = (s: any) => (s && String(s).trim() ? String(s).trim() : "");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function brandHead(title: string, sub: string): string {
  return `<div class="auth-brand">
    <img src="/opencard-logo.svg" alt="OpenCard" style="height:44px;width:auto;margin:0 auto 6px;display:block" />
    <h1 style="font-size:22px">${esc(title)}</h1>
    <p class="auth-sub">${esc(sub)}</p>
  </div>`;
}

// Step 1: just the email.
function emailFirstPage(opts: { sent?: boolean; error?: string } = {}): string {
  return page({
    title: "Create your OpenCard account",
    body: `<div class="auth">
      <div class="auth-card">
        ${brandHead("Create your account", "Start with your work email — we'll send you a link to finish setting up.")}
        ${opts.error ? `<p class="auth-error">${esc(opts.error)}</p>` : ""}
        ${
          opts.sent
            ? `<p class="auth-banner">Check your inbox — we sent a sign-up link. It's valid for 24 hours.</p>
               <p class="auth-foot"><a href="/admin/login">Back to sign in</a></p>`
            : `<form method="POST" action="/signup/start" class="auth-form">
          <label>Work email</label>
          <input name="email" type="email" autocomplete="username" placeholder="you@company.com" required autofocus />
          <button class="btn auth-submit" type="submit">Email me a sign-up link</button>
        </form>
        <p class="auth-foot">Already have an account? <a href="/admin/login">Sign in</a></p>`
        }
      </div>
    </div>`,
  });
}

// Step 2 (and the SMTP-less fallback): the full account form. When `token`
// is set the email is locked to the verified address.
function signupPage(opts: { values?: any; error?: string; token?: string; fixedEmail?: string } = {}): string {
  const v = opts.values || {};
  const email = opts.fixedEmail ?? v.email ?? "";
  return page({
    title: "Create your OpenCard account",
    body: `<div class="auth">
      <div class="auth-card wide">
        ${brandHead(
          opts.fixedEmail ? "Almost there" : "Create your account",
          opts.fixedEmail
            ? `Email verified: ${opts.fixedEmail}. Finish setting up your workspace.`
            : "Set up your organization and owner account. You'll add your team once you're in."
        )}
        ${opts.error ? `<p class="auth-error">${esc(opts.error)}</p>` : ""}
        <form method="POST" action="${opts.token ? "/signup/complete" : "/signup"}" class="auth-form">
          ${opts.token ? `<input type="hidden" name="token" value="${esc(opts.token)}" />` : ""}
          <label>Organization name</label>
          <input name="orgName" value="${esc(v.orgName || "")}" placeholder="Acme Inc" required autofocus />
          <label>Business type</label>
          <select name="businessType">${VERTICALS.map(
            ([val, label]) => `<option value="${esc(val)}" ${v.businessType === val ? "selected" : ""}>${esc(label)}</option>`
          ).join("")}</select>
          <label>Your name</label>
          <input name="adminName" value="${esc(v.adminName || "")}" placeholder="Jane Doe" required />
          <label>Work email</label>
          <input name="email" type="email" value="${esc(email)}" autocomplete="username" ${opts.fixedEmail ? "readonly" : "required"} />
          <label>Password</label>
          <input name="password" type="password" autocomplete="new-password" minlength="8" required />
          <label>First brand name <span class="muted">(optional)</span></label>
          <input name="brandName" value="${esc(v.brandName || "")}" placeholder="defaults to your org name" />
          <label>First location name <span class="muted">(optional)</span></label>
          <input name="locationName" value="${esc(v.locationName || "")}" placeholder="Main" />
          <button class="btn auth-submit" type="submit">Create account</button>
        </form>
        ${opts.fixedEmail ? "" : `<p class="auth-foot">Already have an account? <a href="/admin/login">Sign in</a></p>`}
      </div>
    </div>`,
  });
}

function noticePage(title: string, message: string, cta: { href: string; label: string }): string {
  return page({
    title,
    body: `<div class="auth"><div class="auth-card">
      ${brandHead(title, message)}
      <a class="btn auth-submit auth-sso" href="${esc(cta.href)}">${esc(cta.label)}</a>
    </div></div>`,
  });
}

function disabledPage(): string {
  return page({
    title: "Signups closed",
    body: `<main class="card"><section class="ident"><h1>Signups are closed</h1><p class="company">Self-service signup isn't open on this instance. Contact your administrator for an invite.</p></section><a class="cta" href="/admin/login">Go to sign in</a></main>`,
  });
}

signupRouter.get("/", (_req, res) => {
  if (!config.signupsEnabled) return res.status(404).send(disabledPage());
  res.send(mailEnabled ? emailFirstPage() : signupPage());
});

// Step 1: send the magic link. The response never reveals whether the email
// already has an account — existing owners get a "you already have an
// account" email instead of a sign-up link.
signupRouter.post("/start", async (req, res) => {
  if (!config.signupsEnabled || !mailEnabled) return res.status(404).send(disabledPage());
  const email = clean(req.body?.email).toLowerCase();
  if (!validEmail(email)) return res.status(400).send(emailFirstPage({ error: "Enter a valid email address." }));
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    await sendMail(
      [email],
      "You already have an OpenCard account",
      `Someone (hopefully you) tried to sign up for OpenCard with this address, but an account already exists.\n\n` +
        `Sign in: ${config.baseUrl}/admin/login\n` +
        `Forgot your password? ${config.baseUrl}/admin/forgot`
    );
  } else {
    const raw = await issueToken("signup", email);
    await sendMail(
      [email],
      "Finish creating your OpenCard account",
      `Welcome! Click to finish setting up your OpenCard workspace (link valid for 24 hours):\n\n` +
        `${config.baseUrl}/signup/complete?token=${raw}\n\n` +
        `If you didn't request this, you can ignore this email.`
    );
  }
  res.send(emailFirstPage({ sent: true }));
});

// Step 2: the emailed link opens the real form (token peeked, not consumed,
// so a mistyped password doesn't burn the link).
signupRouter.get("/complete", async (req, res) => {
  if (!config.signupsEnabled) return res.status(404).send(disabledPage());
  const raw = String(req.query.token || "");
  const t = await peekToken("signup", raw);
  if (!t) return res.status(400).send(noticePage("Link expired", "This sign-up link is invalid or has expired. Request a fresh one.", { href: "/signup", label: "Start again" }));
  res.send(signupPage({ token: raw, fixedEmail: t.email }));
});

signupRouter.post("/complete", async (req, res) => {
  if (!config.signupsEnabled) return res.status(404).send(disabledPage());
  const raw = String(req.body?.token || "");
  const t0 = await peekToken("signup", raw);
  if (!t0) return res.status(400).send(noticePage("Link expired", "This sign-up link is invalid or has expired. Request a fresh one.", { href: "/signup", label: "Start again" }));
  const b = req.body || {};
  const values = {
    orgName: clean(b.orgName),
    adminName: clean(b.adminName),
    brandName: clean(b.brandName),
    locationName: clean(b.locationName),
    businessType: isVertical(b.businessType) ? b.businessType : "general",
  };
  const password = String(b.password || "");
  if (!values.orgName || !values.adminName)
    return res.status(400).send(signupPage({ values, token: raw, fixedEmail: t0.email, error: "All required fields must be filled in." }));
  if (password.length < 8)
    return res.status(400).send(signupPage({ values, token: raw, fixedEmail: t0.email, error: "Password must be at least 8 characters." }));
  if (await prisma.adminUser.findUnique({ where: { email: t0.email } }))
    return res.status(409).send(noticePage("Account exists", "An account with this email already exists.", { href: "/admin/login", label: "Sign in" }));
  const t = await consumeToken("signup", raw);
  if (!t) return res.status(400).send(noticePage("Link expired", "This sign-up link was already used.", { href: "/signup", label: "Start again" }));

  await createTenant({
    email: t.email,
    ...values,
    password,
    verified: true, // the magic link already proved the address
  });
  res.redirect("/admin/login?ready=1");
});

// Legacy one-form flow — only reachable when SMTP isn't configured.
signupRouter.post("/", async (req, res) => {
  if (!config.signupsEnabled) return res.status(404).send(disabledPage());
  if (mailEnabled) return res.redirect("/signup"); // magic-link flow owns signup when mail works
  const b = req.body || {};
  const orgName = clean(b.orgName);
  const adminName = clean(b.adminName);
  const email = clean(b.email).toLowerCase();
  const password = String(b.password || "");
  const businessType = isVertical(b.businessType) ? b.businessType : "general";
  const values = { orgName, adminName, email, brandName: clean(b.brandName), locationName: clean(b.locationName), businessType };
  if (!orgName || !adminName || !email) return res.status(400).send(signupPage({ values, error: "All required fields must be filled in." }));
  if (!validEmail(email)) return res.status(400).send(signupPage({ values, error: "Enter a valid email address." }));
  if (password.length < 8) return res.status(400).send(signupPage({ values, error: "Password must be at least 8 characters." }));
  if (await prisma.adminUser.findUnique({ where: { email } })) {
    return res.status(409).send(signupPage({ values, error: "An account with that email already exists. Try signing in." }));
  }
  await createTenant({ email, ...values, password, verified: true }); // can't gate on mail that can't send
  res.redirect("/admin/login?welcome=1");
});

// Create the tenant + owner (+ first brand/rooftop). Org and AdminUser are not
// RLS-scoped (they're needed before tenant context exists); the brand/rooftop
// are created under the new org's RLS context as a consistency check.
async function createTenant(v: {
  email: string;
  orgName: string;
  adminName: string;
  brandName?: string;
  locationName?: string;
  businessType: string;
  password: string;
  verified: boolean;
}): Promise<void> {
  const defaults = await getPlatformConfig();
  const trialEndsAt = new Date(Date.now() + defaults.signupTrialDays * 24 * 60 * 60 * 1000);
  const org = await prisma.org.create({
    data: {
      name: v.orgName,
      vertical: v.businessType,
      plan: defaults.signupPlan,
      subscriptionStatus: "trialing",
      trialEndsAt,
      ownerVerifiedAt: v.verified ? new Date() : null,
    },
  });
  await prisma.adminUser.create({
    data: {
      email: v.email,
      name: v.adminName,
      role: "org_owner",
      orgId: org.id,
      passwordHash: hashPassword(v.password),
      emailVerifiedAt: v.verified ? new Date() : null,
    },
  });
  await runWithOrg(org.id, async (db) => {
    const brand = await db.brand.create({ data: { orgId: org.id, name: v.brandName || v.orgName } });
    await db.location.create({ data: { orgId: org.id, brandId: brand.id, name: v.locationName || "Main" } });
  });
}
