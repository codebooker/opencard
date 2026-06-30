import { Router } from "express";
import { prisma, runWithOrg } from "../db";
import { config } from "../config";
import { hashPassword } from "../security";
import { page, esc } from "../views/html";

// Public self-service onboarding: create a new tenant (Org) with its first owner
// admin, brand, and rooftop. The new owner then signs in at /admin/login (which
// enforces the mandatory MFA enrollment), so we never bypass the auth flow here.
export const signupRouter = Router();

const clean = (s: any) => (s && String(s).trim() ? String(s).trim() : "");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function signupPage(opts: { values?: any; error?: string } = {}): string {
  const v = opts.values || {};
  return page({
    title: "Create your OpenCard account",
    body: `<div class="login" style="max-width:520px">
      <h1>Create your account</h1>
      <p class="muted">Set up your organization and owner account. You'll add your team once you're in.</p>
      ${opts.error ? `<p style="color:#b91c1c">${esc(opts.error)}</p>` : ""}
      <form method="POST" action="/signup">
        <label>Organization name</label>
        <input name="orgName" value="${esc(v.orgName || "")}" placeholder="Acme Auto Group" required />
        <label>Your name</label>
        <input name="adminName" value="${esc(v.adminName || "")}" placeholder="Jane Doe" required />
        <label>Work email</label>
        <input name="email" type="email" value="${esc(v.email || "")}" autocomplete="username" required />
        <label>Password</label>
        <input name="password" type="password" autocomplete="new-password" minlength="8" required />
        <label>First brand name <span class="muted">(optional)</span></label>
        <input name="brandName" value="${esc(v.brandName || "")}" placeholder="defaults to your org name" />
        <label>First location name <span class="muted">(optional)</span></label>
        <input name="locationName" value="${esc(v.locationName || "")}" placeholder="Main" />
        <p style="margin-top:14px"><button class="btn" type="submit">Create account</button></p>
      </form>
      <p class="muted" style="text-align:center">Already have an account? <a href="/admin/login">Sign in</a></p>
    </div>`,
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
  res.send(signupPage());
});

signupRouter.post("/", async (req, res) => {
  if (!config.signupsEnabled) return res.status(404).send(disabledPage());
  const b = req.body || {};
  const orgName = clean(b.orgName);
  const adminName = clean(b.adminName);
  const email = clean(b.email).toLowerCase();
  const password = String(b.password || "");
  const brandName = clean(b.brandName) || orgName;
  const locationName = clean(b.locationName) || "Main";

  const values = { orgName, adminName, email, brandName, locationName };
  if (!orgName || !adminName || !email) return res.status(400).send(signupPage({ values, error: "All required fields must be filled in." }));
  if (!validEmail(email)) return res.status(400).send(signupPage({ values, error: "Enter a valid email address." }));
  if (password.length < 8) return res.status(400).send(signupPage({ values, error: "Password must be at least 8 characters." }));
  if (await prisma.adminUser.findUnique({ where: { email } })) {
    return res.status(409).send(signupPage({ values, error: "An account with that email already exists. Try signing in." }));
  }

  // Create the tenant + its owner. Org and AdminUser are not RLS-scoped (they're
  // needed before any tenant context exists); the brand + rooftop are created
  // under the new org's RLS context as a consistency check.
  const org = await prisma.org.create({ data: { name: orgName } });
  await prisma.adminUser.create({
    data: { email, name: adminName, role: "org_owner", orgId: org.id, passwordHash: hashPassword(password) },
  });
  await runWithOrg(org.id, async (db) => {
    const brand = await db.brand.create({ data: { orgId: org.id, name: brandName } });
    await db.location.create({ data: { orgId: org.id, brandId: brand.id, name: locationName } });
  });

  res.redirect("/admin/login?welcome=1");
});
