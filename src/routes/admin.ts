import crypto from "crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma, Address } from "../db";
import { config } from "../config";
import { clearCookieOptions, cookieOptions } from "../cookies";
import {
  requireAdmin,
  reqAdmin,
  forbidden,
  loginPage,
  breakglassPage,
  mfaPage,
  forgotPage,
  resetPage,
  invitePage,
  authNoticePage,
} from "../middleware/auth";
import {
  issueToken,
  peekToken,
  consumeToken,
  createSession,
  findSession,
  revokeSession,
  revokeAllSessions,
  listSessions,
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
  recoveryCodeCount,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sha256hex,
} from "../account";
import { sendMail } from "../notify";
import { page, esc } from "../views/html";
import { uniqueSlug, uniqueAssetSlug } from "../slug";
import { upload, uploadedUrl } from "../upload";
import { emitEvent, cardPayload, WEBHOOK_EVENTS, replayDelivery, sendTestEvent } from "../webhooks";
import { parseOemBrands, parseCtaLines, rooftopCtas, ctasFromJson, mergeCtas } from "../dealership";
import { buildSignatureModel, renderSignatureHtml, renderSignatureText, normalizeTheme, asLockList } from "../signature";
import { signatureBlock } from "../views/signature-view";
import { parseCampaignRoutingLines } from "../routing";
import { LEAD_STATUSES, canTransition } from "../leadstatus";
import { isConsole, isPlatformRole, PLATFORM_ROLES, assignableStaffRoles, canManageStaffTarget } from "../roles";
import { loginBrandingForHost, requestHost } from "../tenant-resolver";
import { normalizeHost } from "../branding";
import { parseFieldMapLines } from "../crmsync";
import { sendTestSync, retrySync } from "../crmsync-dispatch";
import { isGaId, isGtmId, normalizeCampaignCode } from "../marketing";
import { resolveRange, conversionPct, sortLeaderboard, buildFunnel, topGroups, ANALYTICS_RANGES } from "../analytics";
import { computeOrgAnalytics, analyticsCsv, sendDigest } from "../reports";
import { toCsv } from "../csv";
import { recordAudit, reqIp } from "../audit-log";
import { buildOrgExport, purgeOrgData } from "../data-bundle";
import { exportFilename } from "../dataexport";
import { parseRetentionDays } from "../retention";
import { getPlatformConfig, updatePlatformConfig } from "../platform-config";
import { listBackups, runManualBackup, restoreClientToBackup, withRestoreLock, humanSize } from "../backups";
import {
  credsForOrg,
  directoryConfigSummary,
  saveDirectoryConfig,
  deleteDirectoryConfig,
  testGraphCreds,
  listDirectoryUsers,
  searchGroups,
  filterByDepartment,
  planImport,
  applyImport,
  onlySelected,
  mapGraphUser,
} from "../dirimport";
import { runWithOrg } from "../db";
import { uploadDir } from "../upload";
import { isVertical } from "../terminology";
import { clean, parseLabeled, parseSocials, parseAddress } from "../parse";
import { pruneOrgLeads } from "../retention-prune";

// Compact audit helper bound to the current principal + request.
function audit(
  req: any,
  p: { orgId: string; email: string | null; role: string },
  action: string,
  extra?: { targetType?: string; targetId?: string | null; summary?: string }
) {
  recordAudit({ orgId: p.orgId, actor: { email: p.email, role: p.role }, action, ip: reqIp(req), ...extra });
}
import { promises as dns } from "dns";
import { evaluateDomain, CNAME_TARGET } from "../domainstatus";

const SERVER_IPS = (process.env.SERVER_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);

// Best-effort DNS lookup for the domains hub (CNAME + A records).
async function resolveDomainDns(host: string): Promise<{ cnames: string[]; addrs: string[] }> {
  const cnames: string[] = [];
  const addrs: string[] = [];
  try {
    (await dns.resolveCname(host)).forEach((c) => cnames.push(c));
  } catch {
    /* no CNAME */
  }
  try {
    (await dns.resolve4(host)).forEach((a) => addrs.push(a));
  } catch {
    /* no A record */
  }
  return { cnames, addrs };
}
const PLATFORM_ROLES_ALL = [...PLATFORM_ROLES, "super_admin"];
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
import { requiredPlanFor, planFor, PLANS, PLAN_ORDER, isPlanKey, parseSeatLimit, Feature, LimitKey } from "../plans";
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
// Client-branded login when the request arrives on a registered client domain.
const brandingFor = (req: any) => loginBrandingForHost(requestHost(req));

adminRouter.get("/login", async (req, res) =>
  res.send(
    loginPage(
      undefined,
      req.query.ready
        ? "Account created and email verified — sign in to get started."
        : req.query.welcome
        ? "Account created. Sign in to continue."
        : undefined,
      await brandingFor(req)
    )
  )
);

// Super-admin break-glass token login — on its own unlinked page.
adminRouter.get("/login/breakglass", (_req, res) => res.send(breakglassPage()));

adminRouter.post("/login/token", async (req, res) => {
  if ((req.body?.token || "") === config.adminToken) {
    res.cookie("oc_admin", config.adminToken, cookieOptions(12 * 60 * 60 * 1000));
    recordAudit({ orgId: await defaultOrgId(), actor: { role: "platform_owner" }, action: "login.token", ip: reqIp(req) });
    return res.redirect("/admin");
  }
  recordAudit({ orgId: await defaultOrgId(), action: "login.failed", summary: "break-glass token", ip: reqIp(req) });
  res.status(401).send(breakglassPage("Invalid token."));
});

// Email + password. MFA is optional: if the account has it enabled we ask for a
// code, otherwise we sign in directly. Admins can turn MFA on later under
// Admin -> Security.
adminRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();
  const password = String(req.body?.password || "");
  const au = await prisma.adminUser.findUnique({ where: { email } });
  if (!au || !au.active || !verifyPassword(password, au.passwordHash)) {
    recordAudit({ orgId: await defaultOrgId(), actor: { email }, action: "login.failed", ip: reqIp(req) });
    return res.status(401).send(loginPage("Invalid email or password.", undefined, await brandingFor(req)));
  }
  if (au.mfaEnabled && au.mfaSecret) {
    res.cookie("oc_pwauth", signEmail(email), cookieOptions(5 * 60 * 1000));
    return res.send(mfaPage());
  }
  recordAudit({ orgId: au.orgId ?? (await defaultOrgId()), actor: { email, role: au.role }, action: "login.success", ip: reqIp(req) });
  res.cookie(SESSION_COOKIE, await createSession(au.id, reqIp(req), req.headers["user-agent"] as string), cookieOptions(SESSION_TTL_MS));
  return res.redirect("/admin");
});

adminRouter.post("/login/mfa", async (req, res) => {
  const email = verifyEmail(req.cookies?.oc_pwauth);
  if (!email) return res.redirect("/admin/login");
  const au = await prisma.adminUser.findUnique({ where: { email } });
  if (!au || !au.mfaSecret) return res.status(401).send(mfaPage("Incorrect code, try again."));
  // Accept a 6-digit TOTP or one of the single-use recovery codes.
  const input = String(req.body?.code || "");
  const totpOk = /^\s*\d{6}\s*$/.test(input) && verifyTotp(au.mfaSecret, input.trim());
  const recoveryOk = !totpOk && (await consumeRecoveryCode(au.id, input));
  if (!totpOk && !recoveryOk) return res.status(401).send(mfaPage("Incorrect code, try again."));
  res.clearCookie("oc_pwauth", clearCookieOptions());
  recordAudit({
    orgId: au.orgId ?? (await defaultOrgId()),
    actor: { email, role: au.role },
    action: "login.success",
    summary: recoveryOk ? "MFA (recovery code)" : "MFA",
    ip: reqIp(req),
  });
  res.cookie(SESSION_COOKIE, await createSession(au.id, reqIp(req), req.headers["user-agent"] as string), cookieOptions(SESSION_TTL_MS));
  res.redirect("/admin");
});

adminRouter.get("/logout", async (req, res) => {
  // Revoke the DB session behind this cookie (if any) so it can't be replayed.
  const sess = await findSession(req.cookies?.[SESSION_COOKIE]);
  if (sess) await revokeSession(sess.id, sess.adminUserId);
  res.clearCookie(SESSION_COOKIE, clearCookieOptions());
  res.clearCookie("oc_admin", clearCookieOptions());
  res.clearCookie("oc_emp", clearCookieOptions());
  res.redirect("/admin/login");
});

// ---------- password reset (pre-auth) ----------
adminRouter.get("/forgot", (_req, res) => res.send(forgotPage()));

adminRouter.post("/forgot", async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();
  // Always respond identically — never reveal whether an account exists.
  if (email) {
    const au = await prisma.adminUser.findUnique({ where: { email } });
    if (au && au.active) {
      const raw = await issueToken("reset", email);
      await sendMail(
        [email],
        "Reset your OpenCard password",
        `Someone (hopefully you) asked to reset the password for ${email}.\n\n` +
          `Reset it here (link expires in 1 hour):\n${config.baseUrl}/admin/reset?token=${raw}\n\n` +
          `If this wasn't you, you can ignore this email — your password is unchanged.`
      );
      recordAudit({ orgId: au.orgId ?? (await defaultOrgId()), actor: { email }, action: "password.reset_requested", ip: reqIp(req) });
    }
  }
  res.send(forgotPage({ sent: true }));
});

adminRouter.get("/reset", async (req, res) => {
  const raw = String(req.query.token || "");
  const t = await peekToken("reset", raw);
  if (!t) return res.status(400).send(authNoticePage("Link expired", "This reset link is invalid or has expired. Request a new one.", { href: "/admin/forgot", label: "Request a new link" }));
  res.send(resetPage(raw));
});

adminRouter.post("/reset", async (req, res) => {
  const raw = String(req.body?.token || "");
  const password = String(req.body?.password || "");
  if (password.length < 8) return res.status(400).send(resetPage(raw, "Password must be at least 8 characters."));
  if (password !== String(req.body?.password2 || "")) return res.status(400).send(resetPage(raw, "Passwords don't match."));
  const t = await consumeToken("reset", raw);
  if (!t) return res.status(400).send(authNoticePage("Link expired", "This reset link is invalid or has expired. Request a new one.", { href: "/admin/forgot", label: "Request a new link" }));
  const au = await prisma.adminUser.findUnique({ where: { email: t.email } });
  if (!au || !au.active) return res.status(400).send(authNoticePage("Account unavailable", "This account can't be reset. Contact your administrator.", { href: "/admin/login", label: "Back to sign in" }));
  await prisma.adminUser.update({ where: { id: au.id }, data: { passwordHash: hashPassword(password), emailVerifiedAt: au.emailVerifiedAt ?? new Date() } });
  const revoked = await revokeAllSessions(au.id);
  recordAudit({ orgId: au.orgId ?? (await defaultOrgId()), actor: { email: au.email, role: au.role }, action: "password.reset", summary: `${revoked} session(s) signed out`, ip: reqIp(req) });
  res.send(authNoticePage("Password updated", "Your password has been changed and other sessions were signed out.", { href: "/admin/login", label: "Sign in" }));
});

// ---------- signup email verification (pre-auth) ----------
adminRouter.get("/verify", async (req, res) => {
  const t = await consumeToken("verify", String(req.query.token || ""));
  if (!t) return res.status(400).send(authNoticePage("Link expired", "This verification link is invalid or has expired. Sign in and use “Resend verification email”.", { href: "/admin/login", label: "Sign in" }));
  await prisma.adminUser.updateMany({ where: { email: t.email }, data: { emailVerifiedAt: new Date() } });
  if (t.orgId) await prisma.org.updateMany({ where: { id: t.orgId, ownerVerifiedAt: null }, data: { ownerVerifiedAt: new Date() } });
  recordAudit({ orgId: t.orgId ?? (await defaultOrgId()), actor: { email: t.email }, action: "signup.verified", ip: reqIp(req) });
  res.send(authNoticePage("Email verified", "Your workspace is live — cards and lead capture are now public.", { href: "/admin/login", label: "Sign in" }));
});

// ---------- admin invite acceptance (pre-auth) ----------
adminRouter.get("/invite", async (req, res) => {
  const raw = String(req.query.token || "");
  const t = await peekToken("invite", raw);
  if (!t) return res.status(400).send(authNoticePage("Invite expired", "This invite link is invalid or has expired. Ask your administrator to send a new one.", { href: "/admin/login", label: "Back to sign in" }));
  res.send(invitePage(raw, t.email));
});

adminRouter.post("/invite", async (req, res) => {
  const raw = String(req.body?.token || "");
  const t0 = await peekToken("invite", raw);
  if (!t0) return res.status(400).send(authNoticePage("Invite expired", "This invite link is invalid or has expired. Ask your administrator to send a new one.", { href: "/admin/login", label: "Back to sign in" }));
  const password = String(req.body?.password || "");
  if (password.length < 8) return res.status(400).send(invitePage(raw, t0.email, "Password must be at least 8 characters."));
  if (password !== String(req.body?.password2 || "")) return res.status(400).send(invitePage(raw, t0.email, "Passwords don't match."));
  const t = await consumeToken("invite", raw);
  if (!t) return res.status(400).send(authNoticePage("Invite expired", "This invite link is invalid or has expired.", { href: "/admin/login", label: "Back to sign in" }));
  const au = await prisma.adminUser.findUnique({ where: { email: t.email } });
  if (!au || !au.active) return res.status(400).send(authNoticePage("Account unavailable", "This account no longer exists. Contact your administrator.", { href: "/admin/login", label: "Back to sign in" }));
  await prisma.adminUser.update({ where: { id: au.id }, data: { passwordHash: hashPassword(password), emailVerifiedAt: new Date() } });
  recordAudit({ orgId: au.orgId ?? (await defaultOrgId()), actor: { email: au.email, role: au.role }, action: "admin.invite_accepted", ip: reqIp(req) });
  res.send(authNoticePage("You're all set", "Your password is saved. Sign in to get started.", { href: "/admin/login", label: "Sign in" }));
});

// everything below requires an admin principal (attached as req.admin)
adminRouter.use(requireAdmin);

// Workspace access gate: when a tenant's demo/trial has lapsed (or a subscription
// is past due / canceled), block state-changing actions and steer them to billing.
// Reads still work, so they can see their data and the plan page. Platform owners
// and the billing/logout routes are always allowed.
adminRouter.use(async (req, res, next) => {
  const p = reqAdmin(req);
  if (p.platform) return next();
  if (req.path === "/logout") return next();
  // Suspension is a hard lock: client admins get a notice page, nothing else
  // (platform staff pass above so they can manage/unsuspend the workspace).
  const orgState = await prisma.org.findUnique({ where: { id: p.orgId }, select: { suspended: true } });
  if (orgState?.suspended) {
    return res.status(403).send(
      page({
        title: "Workspace suspended",
        body: `<div class="auth"><div class="auth-card">
          <div class="auth-brand"><img src="/opencard-logo.svg" alt="OpenCard" style="height:44px;width:auto;margin:0 auto 6px;display:block" />
          <h1 style="font-size:20px">Workspace suspended</h1>
          <p class="auth-sub">This workspace has been suspended. Please contact support to restore access.</p></div>
          <a class="btn secondary auth-sso" href="/admin/logout">Sign out</a>
        </div></div>`,
      })
    );
  }
  if (req.method !== "POST") return next();
  if (req.path.startsWith("/billing")) return next();
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
// parseLabeled / parseSocials / parseAddress / clean are shared with the
// self-service routes and live in ../parse.

// Normalize an HTML checkbox group (absent | single string | string[]) to string[].
function asArray(v: any): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v === undefined || v === null || v === "") return [];
  return [String(v)];
}

// Per-rooftop signature design + governance from the location edit form.
function signatureConfig(b: any) {
  return {
    signatureTheme: normalizeTheme(b.signatureTheme),
    signatureDisclaimer: clean(b.signatureDisclaimer) || null,
    signatureLocks: asLockList(asArray(b.signatureLocks)),
  };
}

// Register/update/clear a branded-login domain for a brand or rooftop, of a given
// kind ("admin" or "user"). `scope` is exactly one of { brandId } or { locationId }.
// Host is normalized; blank clears the domain for that scope+kind. Approved so
// Caddy on-demand TLS may issue a cert.
async function setTenantDomain(
  orgId: string,
  scope: { brandId?: string; locationId?: string },
  kind: "admin" | "user",
  rawHost: string
) {
  const host = normalizeHost(rawHost);
  const base = scope.locationId ? { locationId: scope.locationId } : { brandId: scope.brandId, locationId: null };
  await prisma.tenantDomain.deleteMany({ where: { ...base, kind } });
  if (!host) return;
  await prisma.tenantDomain.upsert({
    where: { host },
    update: { orgId, kind, brandId: scope.brandId ?? null, locationId: scope.locationId ?? null, approved: true },
    create: { host, orgId, kind, brandId: scope.brandId ?? null, locationId: scope.locationId ?? null, approved: true },
  });
}

// Brand-wide signature campaign banner (text + optional link + optional window).
function campaignBanner(b: any) {
  const dt = (v: any) => {
    const s = clean(v);
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };
  return {
    signatureBannerText: clean(b.signatureBannerText) || null,
    signatureBannerHref: clean(b.signatureBannerHref) || null,
    signatureBannerStart: dt(b.signatureBannerStart),
    signatureBannerEnd: dt(b.signatureBannerEnd),
  };
}

// ---------- dashboard ----------
// OpenCard staff console: list every client workspace. Drill in to manage one.
adminRouter.get("/clients", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform) return forbidden(res);
  const orgs = await prisma.org.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, subdomain: true, plan: true, billingMode: true, subscriptionStatus: true, suspended: true,
      _count: { select: { brands: true, cards: true, leads: true } },
    },
  });
  res.send(V.clientsConsole(orgs, p));
});

const VALID_MODES = ["free", "standard", "demo"];

adminRouter.get("/clients/new", (req, res) => {
  if (!reqAdmin(req).platform) return forbidden(res);
  res.send(V.clientForm());
});

// ---------- platform settings (signup defaults) ----------
adminRouter.get("/platform", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.staffAdmin) return forbidden(res);
  res.send(V.platformSettingsView(await getPlatformConfig(), req.query.saved === "1"));
});

// ---------- directory import wizard (Phase 13) ----------
// Self-service: org owners connect their OWN Azure tenant on this page.
// Platform staff fall back to env credentials only for testing.

async function importCtx(req: any) {
  const p = reqAdmin(req);
  const t = await currentTerminology(p.orgId);
  // Org-level credentials ONLY — no platform/env fallback (a staff fallback
  // once leaked the platform's directory into every client workspace).
  const resolved = await credsForOrg(p.orgId);
  const summary = await directoryConfigSummary(p.orgId);
  return { p, t, resolved, config: summary ? { ...summary, source: "org" as const } : null };
}

adminRouter.get("/import", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const ctx = await importCtx(req);
  res.send(V.importView({ configured: !!ctx.resolved, t: ctx.t, config: ctx.config, showSettings: req.query.settings === "1" }));
});

// Save/replace the org's Azure credentials, then prove they work.
adminRouter.post("/import/config", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const t = await currentTerminology(p.orgId);
  const tenantId = clean(req.body?.tenantId) || "";
  const clientId = clean(req.body?.clientId) || "";
  const clientSecret = String(req.body?.clientSecret || "").trim();
  try {
    if (!tenantId || !clientId) throw new Error("Directory (tenant) ID and Application (client) ID are required.");
    await saveDirectoryConfig(p.orgId, { tenantId, clientId, clientSecret });
    const resolved = await credsForOrg(p.orgId);
    const test = resolved ? await testGraphCreds(resolved.creds) : { ok: false as const, message: "Saved, but the secret could not be read back." };
    audit(req, p, "import.config", { summary: `Azure directory connection ${test.ok ? "verified" : "saved (test failed)"}` });
    res.send(
      V.importView({
        configured: test.ok,
        t,
        config: { tenantId, clientId, source: "org" },
        showSettings: !test.ok,
        testResult: test.ok ? "Connected — credentials verified against your directory." : null,
        error: test.ok ? undefined : `Saved, but the test call failed: ${test.message}`,
      })
    );
  } catch (e: any) {
    res.send(V.importView({ configured: false, t, config: null, showSettings: true, error: String(e?.message || e).slice(0, 400) }));
  }
});

adminRouter.post("/import/config/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  await deleteDirectoryConfig(p.orgId);
  audit(req, p, "import.config", { summary: "Azure directory connection removed" });
  res.redirect("/admin/import");
});

adminRouter.post("/import/preview", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const ctx = await importCtx(req);
  const { t } = ctx;
  if (!ctx.resolved) return res.send(V.importView({ configured: false, t, config: ctx.config }));
  const creds = ctx.resolved.creds;
  const groupId = clean(req.body?.groupId);
  const deptQuery = clean(req.body?.deptQuery) || "";
  const source = String(req.body?.source || (groupId ? "group" : "all"));
  try {
    if (source === "groupsearch") {
      const q = clean(req.body?.groupQuery) || "";
      const groups = q ? await searchGroups(creds, q) : [];
      return res.send(V.importView({ configured: true, t, config: ctx.config, groups, groupQuery: q }));
    }
    let users = await listDirectoryUsers(creds, groupId || undefined);
    if (source === "department" && deptQuery) users = filterByDepartment(users, deptQuery);
    const rows = await planImport(p.orgId, users);
    res.send(
      V.importView({
        configured: true,
        t,
        config: ctx.config,
        plan: { rows, source, groupId: groupId || undefined, deptQuery: source === "department" ? deptQuery : undefined },
      })
    );
  } catch (e: any) {
    res.send(V.importView({ configured: true, t, config: ctx.config, error: String(e?.message || e).slice(0, 400) }));
  }
});

adminRouter.post("/import/apply", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const ctx = await importCtx(req);
  const { t } = ctx;
  if (!ctx.resolved) return res.send(V.importView({ configured: false, t, config: ctx.config }));
  const creds = ctx.resolved.creds;
  const groupId = clean(req.body?.groupId);
  const deptQuery = clean(req.body?.deptQuery) || "";
  const source = String(req.body?.source || (groupId ? "group" : "all"));
  const selRaw = req.body?.sel;
  const selected = (Array.isArray(selRaw) ? selRaw : selRaw ? [selRaw] : []).map((s: any) => String(s)).slice(0, 5000);
  try {
    if (!selected.length) throw new Error("Nobody is selected — tick at least one person in the preview.");
    // Re-fetch and re-plan at apply time: the directory is the source of
    // truth, and existing emails stay skipped either way.
    let users = await listDirectoryUsers(creds, groupId || undefined);
    if (source === "department" && deptQuery) users = filterByDepartment(users, deptQuery);
    const rows = onlySelected(await planImport(p.orgId, users), selected);
    const result = await applyImport(p.orgId, rows);
    audit(req, p, "import.graph", {
      summary: `${result.created} created, ${result.skipped} skipped (${selected.length} selected${groupId ? `, group ${groupId}` : ""}${deptQuery ? `, dept "${deptQuery}"` : ""})`,
    });
    res.send(V.importView({ configured: true, t, config: ctx.config, result }));
  } catch (e: any) {
    res.send(V.importView({ configured: true, t, config: ctx.config, error: String(e?.message || e).slice(0, 400) }));
  }
});

// ---------- sync health (Phase 13): what the directory paths created ----------

async function syncOverview(orgId: string) {
  const groups = await prisma.user.groupBy({
    by: ["provisionedBy"],
    where: { orgId },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const bySource = (s: string | null) => groups.find((g) => g.provisionedBy === s);
  const row = (s: string | null) => ({
    count: bySource(s)?._count._all || 0,
    last: bySource(s)?._max.createdAt || null,
  });
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { scimTokenHash: true } });
  return {
    scim: row("scim"),
    imported: row("import"),
    jit: row("jit"),
    manual: row(null),
    scimTokenSet: !!org?.scimTokenHash,
    dirConfigured: !!(await credsForOrg(orgId)),
  };
}

adminRouter.get("/sync", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  res.send(V.syncView({ t: await currentTerminology(p.orgId), overview: await syncOverview(p.orgId) }));
});

// Compare the live directory against active cards: who no longer exists (or is
// disabled) in Azure but still has a public card here. Read-only.
adminRouter.post("/sync/check", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const t = await currentTerminology(p.orgId);
  const overview = await syncOverview(p.orgId);
  try {
    const resolved = await credsForOrg(p.orgId);
    if (!resolved) throw new Error("Connect your Azure directory on the Import page first.");
    const dirUsers = (await listDirectoryUsers(resolved.creds)).map(mapGraphUser).filter((c): c is NonNullable<typeof c> => !!c);
    const inDirectory = new Set(dirUsers.map((u) => u.email));
    const disabled = new Set(dirUsers.filter((u) => !u.enabled).map((u) => u.email));
    const cards = await prisma.card.findMany({
      where: { orgId: p.orgId, active: true, ownerEmail: { not: null } },
      select: { id: true, firstName: true, lastName: true, ownerEmail: true },
    });
    const orphans = cards
      .map((c) => {
        const email = (c.ownerEmail || "").toLowerCase();
        const reason = !inDirectory.has(email) ? "not in directory" : disabled.has(email) ? "disabled in directory" : null;
        return reason ? { id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), email, reason } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    res.send(V.syncView({ t, overview, checked: { total: cards.length, directorySize: dirUsers.length, orphans } }));
  } catch (e: any) {
    res.send(V.syncView({ t, overview, error: String(e?.message || e).slice(0, 400) }));
  }
});

// Deactivate the selected orphaned cards (card unpublished + user deactivated).
// Reversible from the card editor; nothing is deleted.
adminRouter.post("/sync/deactivate", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const t = await currentTerminology(p.orgId);
  const selRaw = req.body?.sel;
  const ids = (Array.isArray(selRaw) ? selRaw : selRaw ? [selRaw] : []).map((s: any) => String(s)).slice(0, 5000);
  let deactivated = 0;
  if (ids.length) {
    // Org-scoped: ids from another tenant simply don't match.
    const cards = await prisma.card.findMany({
      where: { id: { in: ids }, orgId: p.orgId },
      select: { id: true, userId: true },
    });
    await runWithOrg(p.orgId, async (db) => {
      await db.card.updateMany({ where: { id: { in: cards.map((c) => c.id) } }, data: { active: false } });
      const userIds = cards.map((c) => c.userId).filter((x): x is string => !!x);
      if (userIds.length) await db.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
      deactivated = cards.length;
    });
    audit(req, p, "sync.deactivate", { summary: `${deactivated} orphaned ${deactivated === 1 ? "card" : "cards"} deactivated` });
  }
  res.send(V.syncView({ t, overview: await syncOverview(p.orgId), flash: `${deactivated} deactivated.` }));
});

// ---------- backups & per-client restore (platform owner/admin) ----------
adminRouter.get("/backups", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.staffAdmin) return forbidden(res);
  const orgs = await prisma.org.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  res.send(
    V.backupsView({
      backups: listBackups().map((b) => ({ ...b, sizeHuman: humanSize(b.size) })),
      orgs,
      flash: req.query.ran
        ? "Backup complete."
        : req.query.restored
        ? `Client restored (${String(req.query.restored)} rows).`
        : null,
      error: req.query.error ? String(req.query.error).slice(0, 300) : null,
    })
  );
});

adminRouter.post("/backups/run", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.staffAdmin) return forbidden(res);
  try {
    const out = await runManualBackup(uploadDir);
    audit(req, p, "backup.manual", { summary: out.db });
    res.redirect("/admin/backups?ran=1");
  } catch (e: any) {
    res.redirect("/admin/backups?error=" + encodeURIComponent(String(e?.message || e).slice(0, 200)));
  }
});

adminRouter.post("/backups/restore-client", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.staffAdmin) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: String(req.body?.orgId || "") }, select: { id: true, name: true } });
  if (!org) return res.redirect("/admin/backups?error=" + encodeURIComponent("Client not found."));
  if (String(req.body?.confirmName || "") !== org.name)
    return res.redirect("/admin/backups?error=" + encodeURIComponent("The client name you typed does not match."));
  const dump = String(req.body?.dump || "");
  try {
    const result = await withRestoreLock(() => restoreClientToBackup(org.id, dump));
    audit(req, p, "backup.restore_client", { targetType: "Org", targetId: org.id, summary: `${org.name} <- ${dump} (${result.rows} rows)` });
    res.redirect("/admin/backups?restored=" + result.rows);
  } catch (e: any) {
    audit(req, p, "backup.restore_failed", { targetType: "Org", targetId: org.id, summary: String(e?.message || e).slice(0, 150) });
    res.redirect("/admin/backups?error=" + encodeURIComponent(String(e?.message || e).slice(0, 200)));
  }
});

adminRouter.post("/platform", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.staffAdmin) return forbidden(res);
  const saved = await updatePlatformConfig({
    signupPlan: String(req.body?.signupPlan || ""),
    signupTrialDays: parseInt(String(req.body?.signupTrialDays || ""), 10),
  });
  audit(req, p, "platform.settings", { targetType: "PlatformConfig", summary: JSON.stringify(saved) });
  res.redirect("/admin/platform?saved=1");
});

adminRouter.post("/clients", async (req, res) => {
  if (!reqAdmin(req).platform) return forbidden(res);
  const b = req.body;
  const name = clean(b.name);
  if (!name) return res.redirect("/admin/clients/new");
  const mode = VALID_MODES.includes(b.billingMode) ? b.billingMode : "standard";
  const demo =
    mode === "demo"
      ? {
          trialEndsAt: new Date(Date.now() + (Number(b.demoDays) === 60 ? 60 : 30) * 24 * 60 * 60 * 1000),
          subscriptionStatus: "trialing",
        }
      : {};
  await prisma.org.create({
    data: {
      name,
      vertical: isVertical(b.businessType) ? b.businessType : "general",
      plan: isPlanKey(b.plan) ? b.plan : "starter",
      billingMode: mode,
      seatLimit: parseSeatLimit(b.seatLimit),
      // Staff-created clients skip signup email verification (staff vouches).
      ownerVerifiedAt: new Date(),
      ...demo,
    },
  });
  res.redirect("/admin/clients");
});

adminRouter.get("/clients/:orgId/settings", async (req, res) => {
  if (!reqAdmin(req).platform) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: req.params.orgId } });
  if (!org) return res.status(404).send("Client not found");
  res.send(V.clientForm(org));
});

adminRouter.post("/clients/:orgId/settings", async (req, res) => {
  if (!reqAdmin(req).platform) return forbidden(res);
  const b = req.body;
  const data: any = { seatLimit: parseSeatLimit(b.seatLimit) };
  if (clean(b.name)) data.name = clean(b.name);
  if (isVertical(b.businessType)) data.vertical = b.businessType;
  if (isPlanKey(b.plan)) data.plan = b.plan;
  if (VALID_MODES.includes(b.billingMode)) {
    data.billingMode = b.billingMode;
    if (b.billingMode === "demo") {
      data.trialEndsAt = new Date(Date.now() + (Number(b.demoDays) === 60 ? 60 : 30) * 24 * 60 * 60 * 1000);
      data.subscriptionStatus = "trialing";
    }
  }
  await prisma.org.update({ where: { id: req.params.orgId }, data });
  res.redirect("/admin/clients");
});

// Suspend / unsuspend a client workspace (platform staff only). A suspended
// org is fully dark: admin UI, self-service, API, and all public surfaces.
adminRouter.post("/clients/:orgId/suspend", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: req.params.orgId }, select: { id: true, suspended: true, name: true } });
  if (!org) return res.status(404).send("Client not found");
  const suspended = !org.suspended;
  await prisma.org.update({ where: { id: org.id }, data: { suspended } });
  audit(req, p, suspended ? "client.suspend" : "client.unsuspend", {
    targetType: "Org",
    targetId: org.id,
    summary: org.name,
  });
  res.redirect(`/admin/clients/${org.id}/settings`);
});

// Permanently delete a client: purge all tenant data, then remove the org's
// admin accounts, audit trail, and the org row itself. Platform staff only,
// gated on typing the client name exactly.
adminRouter.post("/clients/:orgId/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: req.params.orgId }, select: { id: true, name: true } });
  if (!org) return res.status(404).send("Client not found");
  if (String(req.body?.confirmName || "") !== org.name) {
    return res.status(400).send(
      page({
        title: "Name mismatch",
        body: `<main class="admin"><h2>Name didn't match</h2><p class="muted">To delete <strong>${esc(
          org.name
        )}</strong>, type its name exactly.</p><a class="btn secondary" href="/admin/clients/${esc(org.id)}/settings">Back</a></main>`,
      })
    );
  }
  // Audit first, attributed to the platform org, so the record outlives the client.
  audit(req, p, "client.delete", { targetType: "Org", targetId: org.id, summary: org.name });
  await purgeOrgData(org.id);
  await prisma.auditLog.deleteMany({ where: { orgId: org.id } });
  await prisma.adminUser.deleteMany({ where: { orgId: org.id } }); // scopes cascade
  await prisma.org.delete({ where: { id: org.id } });
  res.redirect("/admin/clients");
});

adminRouter.post("/clients/:orgId/enter", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: req.params.orgId }, select: { id: true } });
  if (!org) return res.status(404).send("Client not found");
  res.cookie("oc_actorg", org.id, cookieOptions(12 * 60 * 60 * 1000));
  res.redirect("/admin");
});

adminRouter.get("/clients/exit", (_req, res) => {
  res.clearCookie("oc_actorg", clearCookieOptions());
  res.redirect("/admin");
});

adminRouter.get("/", async (req, res) => {
  const p = reqAdmin(req);
  const t = await currentTerminology(reqAdmin(req).orgId);
  // OpenCard staff who haven't drilled into a client see the clients console.
  if (isConsole(p)) return res.redirect("/admin/clients");
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
  // When a platform admin has drilled into a client, show whose workspace this is.
  let actingClientName: string | undefined;
  if (p.actingOrgId) {
    const org = await prisma.org.findUnique({ where: { id: p.actingOrgId }, select: { name: true } });
    actingClientName = org?.name;
  }
  // Unverified self-signup org: banner until the owner confirms their email.
  const own = await prisma.org.findUnique({ where: { id: p.orgId }, select: { ownerVerifiedAt: true } });
  const verifyState = own?.ownerVerifiedAt ? null : req.query.verify === "sent" ? ("sent" as const) : ("needed" as const);
  res.send(V.dashboard(brands as any, p, t, actingClientName, verifyState));
});

// ---------- security (per-account two-factor) ----------
adminRouter.get("/security", async (req, res) => {
  const p = reqAdmin(req);
  const note =
    req.query.mfa === "on"
      ? `<p style="color:#15803d">Two-factor is now enabled.</p>`
      : req.query.mfa === "off"
      ? `<p class="muted">Two-factor disabled.</p>`
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

// ---------- brands ----------
adminRouter.get("/brands/new", async (req, res) => {
  if (!RBAC.canCreateBrand(reqAdmin(req))) return forbidden(res);
  res.send(V.brandForm(undefined, undefined, await currentTerminology(reqAdmin(req).orgId)));
});
adminRouter.get("/brands/:id/edit", async (req, res) => {
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),req.params.id)) return forbidden(res);
  const t = await currentTerminology(reqAdmin(req).orgId);
  const brand = await prisma.brand.findUnique({
    where: { id: req.params.id },
    include: { locations: { include: { _count: { select: { cards: true } } } }, domains: true },
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
      ...campaignBanner(b),
    },
  });
  res.redirect("/admin");
});
adminRouter.post("/brands/:id", upload.single("logoFile"), async (req, res) => {
  const p = reqAdmin(req);
  if (!await RBAC.canManageBrandScoped(p, req.params.id)) return forbidden(res);
  const b = req.body;
  const brand = await prisma.brand.update({
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
      ...campaignBanner(b),
    },
  });
  await setTenantDomain(brand.orgId, { brandId: brand.id }, "admin", b.adminDomain);
  await setTenantDomain(brand.orgId, { brandId: brand.id }, "user", b.userDomain);
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
  audit(req, reqAdmin(req), "brand.delete", { targetType: "Brand", targetId: brand.id, summary: brand.name });
  res.redirect("/admin");
});

// ---------- templates ----------
adminRouter.get("/templates", async (req, res) => {
  const brandId = String(req.query.brandId || "");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),brandId)) return forbidden(res);
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) return res.status(404).send("Brand not found");
  const templates = await prisma.template.findMany({ where: { brandId }, orderBy: { createdAt: "asc" } });
  res.send(V.templatesGallery(brand.name, brandId, templates));
});
adminRouter.get("/templates/new", async (req, res) => {
  const brandId = String(req.query.brandId || "");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),brandId)) return forbidden(res);
  res.send(V.templateForm(brandId, undefined, await currentTerminology(reqAdmin(req).orgId)));
});
adminRouter.get("/templates/:id/edit", async (req, res) => {
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),tpl.brandId)) return forbidden(res);
  res.send(V.templateForm(tpl.brandId, tpl, await currentTerminology(reqAdmin(req).orgId)));
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
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),b.brandId)) return forbidden(res);
  if (b.isDefault) await prisma.template.updateMany({ where: { brandId: b.brandId }, data: { isDefault: false } });
  await prisma.template.create({ data: { brandId: b.brandId, orgId: await orgIdForBrand(b.brandId), ...templateData(b) } });
  res.redirect(`/admin/templates?brandId=${b.brandId}`);
});
adminRouter.post("/templates/:id", async (req, res) => {
  const b = req.body;
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),tpl.brandId)) return forbidden(res);
  if (b.isDefault) await prisma.template.updateMany({ where: { brandId: tpl.brandId }, data: { isDefault: false } });
  await prisma.template.update({ where: { id: req.params.id }, data: templateData(b) });
  res.redirect(`/admin/templates?brandId=${tpl.brandId}`);
});
adminRouter.post("/templates/:id/delete", async (req, res) => {
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),tpl.brandId)) return forbidden(res);
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
    // Checkbox is "show footer"; absent = hide. The location form always renders it.
    hideCardFooter: b.showFooter !== "1",
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
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),brandId)) return forbidden(res);
  res.send(V.locationForm(brandId, undefined, await currentTerminology(reqAdmin(req).orgId)));
});
adminRouter.get("/locations/:id/edit", async (req, res) => {
  const loc = await prisma.location.findUnique({ where: { id: req.params.id }, include: { domains: true } });
  if (!loc) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
  res.send(V.locationForm(loc.brandId, loc, await currentTerminology(reqAdmin(req).orgId)));
});
adminRouter.post("/locations", upload.single("logoFile"), async (req, res) => {
  const p = reqAdmin(req);
  const b = req.body;
  if (!(await RBAC.canManageBrandScoped(p, b.brandId))) return forbidden(res);
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
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
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
      ...signatureConfig(b),
    },
  });
  await setTenantDomain(loc.orgId, { locationId: loc.id }, "admin", b.adminDomain);
  await setTenantDomain(loc.orgId, { locationId: loc.id }, "user", b.userDomain);
  res.redirect("/admin");
});

// ---------- custom domains hub (self-serve branded-login onboarding) ----------
// Resolve the brand a domain belongs to (for permission checks).
function domainBrandId(d: any): string | null {
  return d.brandId || d.location?.brandId || null;
}

adminRouter.get("/domains", async (req, res) => {
  const p = reqAdmin(req);
  const orgWhere = RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId };
  const all = await prisma.tenantDomain.findMany({
    where: orgWhere,
    include: { brand: true, location: { include: { brand: true } } },
    orderBy: { createdAt: "asc" },
  });
  // Non-global admins only see domains for brands/rooftops they can access.
  const accessible = new Set(await RBAC.accessibleBrandIds(p));
  const domains = p.global ? all : all.filter((d) => accessible.has(domainBrandId(d) || ""));
  const brandIds = await RBAC.accessibleBrandIds(p);
  const brands = await prisma.brand.findMany({
    where: { id: { in: brandIds } },
    include: { locations: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
  const flash =
    typeof req.query.checked === "string"
      ? `Checked ${req.query.checked}: ${req.query.msg || ""}`
      : req.query.added
      ? "Domain added. Create the DNS record below, then click Verify."
      : null;
  res.send(V.domainsView({ domains, brands, target: CNAME_TARGET, flash }));
});

adminRouter.post("/domains", async (req, res) => {
  const p = reqAdmin(req);
  const host = normalizeHost(req.body?.host);
  const kind = req.body?.kind === "admin" ? "admin" : "user";
  const [scopeType, scopeId] = String(req.body?.scope || "").split(":");
  if (!host || !scopeId) return res.redirect("/admin/domains");
  let orgId: string, brandForPerm: string, scope: { brandId?: string; locationId?: string };
  if (scopeType === "location") {
    const loc = await prisma.location.findUnique({ where: { id: scopeId } });
    if (!loc) return res.status(404).send("Not found");
    orgId = loc.orgId;
    brandForPerm = loc.brandId;
    scope = { locationId: loc.id };
  } else {
    const brand = await prisma.brand.findUnique({ where: { id: scopeId } });
    if (!brand) return res.status(404).send("Not found");
    orgId = brand.orgId;
    brandForPerm = brand.id;
    scope = { brandId: brand.id };
  }
  if (!(await RBAC.canManageBrandScoped(p, brandForPerm))) return forbidden(res);
  await setTenantDomain(orgId, scope, kind as "admin" | "user", host);
  audit(req, p, "domain.add", { targetType: "TenantDomain", summary: `${host} (${kind})` });
  res.redirect("/admin/domains?added=1");
});

adminRouter.post("/domains/:id/verify", async (req, res) => {
  const p = reqAdmin(req);
  const d = await prisma.tenantDomain.findUnique({
    where: { id: req.params.id },
    include: { location: true },
  });
  if (!d) return res.status(404).send("Not found");
  const brandId = domainBrandId(d);
  if (!brandId || !(await RBAC.canManageBrandScoped(p, brandId))) return forbidden(res);
  const verdict = evaluateDomain(await resolveDomainDns(d.host), { cnameTarget: CNAME_TARGET, ips: SERVER_IPS });
  await prisma.tenantDomain.update({
    where: { id: d.id },
    data: { verifyState: verdict.ok ? "verified" : "pending", verifiedAt: new Date() },
  });
  res.redirect(`/admin/domains?checked=${encodeURIComponent(d.host)}&msg=${encodeURIComponent(verdict.reason)}`);
});

adminRouter.post("/domains/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  const d = await prisma.tenantDomain.findUnique({ where: { id: req.params.id }, include: { location: true } });
  if (!d) return res.redirect("/admin/domains");
  const brandId = domainBrandId(d);
  if (!brandId || !(await RBAC.canManageBrandScoped(p, brandId))) return forbidden(res);
  await prisma.tenantDomain.delete({ where: { id: d.id } });
  audit(req, p, "domain.remove", { targetType: "TenantDomain", targetId: d.id, summary: d.host });
  res.redirect("/admin/domains");
});

// ---------- departments (per rooftop) ----------
async function locationForDept(id: string) {
  return prisma.location.findUnique({ where: { id }, select: { id: true, name: true, brandId: true, orgId: true } });
}

adminRouter.get("/locations/:id/departments", async (req, res) => {
  const loc = await locationForDept(req.params.id);
  if (!loc) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
  const departments = await prisma.department.findMany({
    where: { locationId: loc.id },
    orderBy: { name: "asc" },
  });
  res.send(V.departmentsView({ location: loc, departments }, await currentTerminology(reqAdmin(req).orgId)));
});

adminRouter.post("/locations/:id/departments", async (req, res) => {
  const loc = await locationForDept(req.params.id);
  if (!loc) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
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
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),dept.location.brandId)) return forbidden(res);
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
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
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
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
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
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),asset.location.brandId)) return forbidden(res);
  await prisma.asset.delete({ where: { id: asset.id } });
  res.redirect(`/admin/locations/${asset.location.id}/assets`);
});

// ---------- cards ----------
adminRouter.get("/cards", async (req, res) => {
  const t = await currentTerminology(reqAdmin(req).orgId);
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
  const t = await currentTerminology(reqAdmin(req).orgId);
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
  const t = await currentTerminology(reqAdmin(req).orgId);
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
  // null == "no card filter" (every org). Only the platform console sees all;
  // an org-global admin (incl. a platform admin drilled into a client) is scoped
  // to their org via accessibleLocationIds, which already filters by orgId.
  if (RBAC.seesAllOrgs(p)) return null;
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
  const p = reqAdmin(req);
  const range = resolveRange(req.query.range);
  const cardIds = await accessibleCardIds(p); // null = all orgs (platform console)
  const cardFilter = cardIds ? { cardId: { in: cardIds } } : {};
  const dateFilter = range.since ? { createdAt: { gte: range.since } } : {};
  const whereEvents = { ...cardFilter, ...dateFilter };

  // Event totals by type (views, vcard saves, clicks, connects) in range.
  const grouped = await prisma.analyticsEvent.groupBy({ by: ["type"], where: whereEvents, _count: { _all: true } });
  const totals: Record<string, number> = {};
  grouped.forEach((g) => (totals[g.type] = g._count._all));

  // Leads captured (cards + assets) in scope + range.
  const leadScope = await leadScopeWhere(p);
  const leadWhere = { ...leadScope, ...(range.since ? { createdAt: { gte: range.since } } : {}) };
  const leadCount = await prisma.lead.count({ where: leadWhere });

  // Rooftop leaderboard + breakdowns from a single lead fetch + entity maps.
  const locIds = await RBAC.accessibleLocationIds(p);
  const [locations, cards, assets, departments, viewsByCard, leadsInRange, scanAgg] = await Promise.all([
    prisma.location.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true } }),
    prisma.card.findMany({
      where: { locationId: { in: locIds } },
      select: { id: true, locationId: true, departmentId: true, firstName: true, lastName: true },
    }),
    prisma.asset.findMany({ where: { locationId: { in: locIds } }, select: { id: true, locationId: true, type: true } }),
    prisma.department.findMany({ where: { orgId: p.orgId }, select: { id: true, name: true } }),
    prisma.analyticsEvent.groupBy({ by: ["cardId"], where: { type: "view", ...whereEvents }, _count: { _all: true } }),
    prisma.lead.findMany({
      where: leadWhere,
      select: { cardId: true, assetId: true, status: true, campaign: true, utmCampaign: true, utmSource: true },
    }),
    prisma.asset.aggregate({ where: { locationId: { in: locIds } }, _sum: { scanCount: true } }),
  ]);
  const cardLoc = new Map(cards.map((c) => [c.id, c.locationId]));
  const cardName = new Map(cards.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]));
  const cardDept = new Map(cards.map((c) => [c.id, c.departmentId]));
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const assetLoc = new Map(assets.map((a) => [a.id, a.locationId]));
  const assetType = new Map(assets.map((a) => [a.id, a.type]));

  const per = new Map<string, { views: number; leads: number }>();
  locations.forEach((l) => per.set(l.id, { views: 0, leads: 0 }));
  viewsByCard.forEach((v) => {
    const loc = cardLoc.get(v.cardId);
    if (loc && per.has(loc)) per.get(loc)!.views += v._count._all;
  });
  // Breakdown counters.
  const statusCounts: Record<string, number> = {};
  const campaignCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  const employeeCounts: Record<string, number> = {};
  const deptCounts: Record<string, number> = {};
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] || 0) + 1);
  leadsInRange.forEach((l) => {
    const loc = (l.cardId && cardLoc.get(l.cardId)) || (l.assetId && assetLoc.get(l.assetId));
    if (loc && per.has(loc)) per.get(loc)!.leads++;
    bump(statusCounts, l.status || "new");
    const camp = l.campaign || l.utmCampaign;
    if (camp) bump(campaignCounts, camp);
    // Source channel: employee card vs the asset's type.
    if (l.cardId) bump(sourceCounts, "Employee card");
    else if (l.assetId) bump(sourceCounts, assetTypeLabel(assetType.get(l.assetId) || "campaign"));
    // Employee (card owner).
    if (l.cardId && cardName.get(l.cardId)) bump(employeeCounts, cardName.get(l.cardId)!);
    // Department.
    const dId = l.cardId ? cardDept.get(l.cardId) : null;
    bump(deptCounts, (dId && deptName.get(dId)) || "No department");
  });
  const leaderboard = sortLeaderboard(
    locations.map((l) => ({ id: l.id, name: l.name, views: per.get(l.id)!.views, leads: per.get(l.id)!.leads }))
  );
  const funnel = buildFunnel(statusCounts);
  const sources = topGroups(sourceCounts, 20);
  const campaigns = topGroups(campaignCounts, 10);
  const employees = topGroups(employeeCounts, 10);
  const deptPerf = topGroups(deptCounts, 20);

  // Top cards by views (in range).
  const topViews = await prisma.analyticsEvent.groupBy({
    by: ["cardId"],
    where: { type: "view", ...whereEvents },
    _count: { _all: true },
    orderBy: { _count: { cardId: "desc" } },
    take: 10,
  });
  const topCardRows = await prisma.card.findMany({ where: { id: { in: topViews.map((v) => v.cardId) } } });
  const byId = new Map(topCardRows.map((c) => [c.id, c]));
  const topCards = topViews.map((v) => {
    const c = byId.get(v.cardId);
    return { name: c ? `${c.firstName} ${c.lastName}` : "—", slug: c?.slug || "", views: v._count._all };
  });

  // Reporting controls (CSV export + manager digest) — org-level, so gate to global admins.
  const orgSettings = p.global
    ? await prisma.org.findUnique({ where: { id: p.orgId }, select: { digestEmails: true, digestCadence: true } })
    : null;
  const reports = p.global
    ? {
        csvUrl: `/admin/analytics/export.csv?range=${range.key}`,
        emails: orgSettings?.digestEmails || "",
        cadence: orgSettings?.digestCadence || "off",
        sent: req.query.digest === "sent",
      }
    : undefined;

  res.send(
    V.analyticsView({
      locationLabel: (await currentTerminology(p.orgId)).locationSingular,
      totals,
      leadCount,
      conversion: conversionPct(leadCount, totals["view"] || 0),
      assetScans: scanAgg._sum.scanCount || 0,
      leaderboard,
      topCards,
      funnel,
      sources,
      campaigns,
      employees,
      deptPerf,
      range: { key: range.key, label: range.label },
      ranges: ANALYTICS_RANGES,
      reports,
    })
  );
});

// CSV export of the org-wide analytics report.
adminRouter.get("/analytics/export.csv", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const rangeKey = String(req.query.range || "30");
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { name: true } });
  const data = await computeOrgAnalytics(p.orgId, rangeKey);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="opencard-analytics-${data.range.key}.csv"`);
  res.send(analyticsCsv(org?.name || "OpenCard", data));
});

// Save the manager-digest recipients + cadence.
adminRouter.post("/reports/digest", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const cadence = req.body?.cadence === "weekly" ? "weekly" : "off";
  await prisma.org.update({
    where: { id: p.orgId },
    data: { digestEmails: clean(req.body?.digestEmails) || null, digestCadence: cadence },
  });
  res.redirect("/admin/analytics");
});

// Send a digest right now (test / on-demand).
adminRouter.post("/reports/digest/test", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  await sendDigest(p.orgId);
  res.redirect("/admin/analytics?digest=sent");
});

// ---------- audit log (Phase 9.1) ----------
adminRouter.get("/audit", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const action = typeof req.query.action === "string" && req.query.action ? String(req.query.action) : null;
  const where = { ...(RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId }), ...(action ? { action } : {}) };
  const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 250 });
  res.send(V.auditView(logs, action));
});

// ---------- data & privacy (GDPR/CCPA) (Phase 9.2) ----------
adminRouter.get("/data", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { name: true, leadRetentionDays: true } });
  // Full org purge is platform-staff-only, and only while drilled into a client.
  res.send(
    V.dataPrivacyView({
      orgName: org?.name || "",
      canPurge: p.platform && !!p.actingOrgId,
      done: req.query.done === "1",
      retentionDays: org?.leadRetentionDays ?? null,
      pruned: typeof req.query.pruned === "string" ? Number(req.query.pruned) : null,
    })
  );
});

// Set the lead retention policy.
adminRouter.post("/data/retention", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const days = parseRetentionDays(req.body?.leadRetentionDays);
  await prisma.org.update({ where: { id: p.orgId }, data: { leadRetentionDays: days } });
  audit(req, p, "data.retention", { targetType: "Org", targetId: p.orgId, summary: days ? `${days} days` : "keep forever" });
  res.redirect("/admin/data");
});

// Run the retention prune for this org now (on-demand).
adminRouter.post("/data/retention/prune", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { leadRetentionDays: true } });
  const n = await pruneOrgLeads(p.orgId, org?.leadRetentionDays ?? null);
  res.redirect("/admin/data?pruned=" + n);
});

// ---------- events (Phase 10.2) ----------
function parseDateLocal(v: any): Date | null {
  const s = clean(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

adminRouter.get("/events", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const scope = RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId };
  const [events, locations] = await Promise.all([
    prisma.event.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      include: { location: { select: { name: true } }, _count: { select: { assets: true } } },
    }),
    prisma.location.findMany({ where: scope, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  res.send(V.eventsView({ events, locations }, await currentTerminology(reqAdmin(req).orgId)));
});

adminRouter.post("/events", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const b = req.body || {};
  const name = clean(b.name);
  if (!name) return res.redirect("/admin/events");
  let locationId: string | null = null;
  if (b.locationId) {
    const loc = await prisma.location.findFirst({ where: { id: String(b.locationId), orgId: p.orgId } });
    locationId = loc?.id || null;
  }
  const ev = await prisma.event.create({
    data: { orgId: p.orgId, name, locationId, startsAt: parseDateLocal(b.startsAt), endsAt: parseDateLocal(b.endsAt), active: true },
  });
  res.redirect("/admin/events/" + ev.id);
});

adminRouter.get("/events/:id", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const where = RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId };
  const ev = await prisma.event.findFirst({ where, include: { location: true, assets: { orderBy: { createdAt: "asc" } } } });
  if (!ev) return res.status(404).send("Event not found");
  const assetIds = ev.assets.map((a) => a.id);
  const scans = ev.assets.reduce((s, a) => s + a.scanCount, 0);
  const leads = assetIds.length ? await prisma.lead.count({ where: { assetId: { in: assetIds } } }) : 0;
  const locations = await prisma.location.findMany({
    where: RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  res.send(V.eventDetailView({ ev, scans, leads, baseUrl: config.cardUrl, locations }, await currentTerminology(reqAdmin(req).orgId)));
});

adminRouter.post("/events/:id", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const where = RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId };
  const ev = await prisma.event.findFirst({ where });
  if (!ev) return res.status(404).send("Not found");
  const b = req.body || {};
  await prisma.event.update({
    where: { id: ev.id },
    data: { name: clean(b.name) || ev.name, startsAt: parseDateLocal(b.startsAt), endsAt: parseDateLocal(b.endsAt), active: !!b.active },
  });
  res.redirect("/admin/events/" + ev.id);
});

adminRouter.post("/events/:id/assets", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const where = RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId };
  const ev = await prisma.event.findFirst({ where });
  if (!ev) return res.status(404).send("Not found");
  const b = req.body || {};
  const name = clean(b.name) || "Event QR";
  let locationId = ev.locationId;
  if (!locationId && b.locationId) {
    const loc = await prisma.location.findFirst({ where: { id: String(b.locationId), orgId: p.orgId } });
    locationId = loc?.id || null;
  }
  if (!locationId) return res.status(400).send("Set an event rooftop first (edit the event), then add QR codes.");
  const slug = await uniqueAssetSlug(name);
  await prisma.asset.create({
    data: { orgId: p.orgId, locationId, type: "event", name, slug, destinationType: "landing", eventId: ev.id, active: true },
  });
  res.redirect("/admin/events/" + ev.id);
});

adminRouter.post("/events/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  await prisma.event.deleteMany({ where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId } });
  res.redirect("/admin/events");
});

adminRouter.get("/data/export.json", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { name: true } });
  const bundle = await buildOrgExport(p.orgId);
  audit(req, p, "data.export", { targetType: "Org", targetId: p.orgId });
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${exportFilename(org?.name)}"`);
  res.send(JSON.stringify(bundle, null, 2));
});

// Erase all operational data for the drilled-in client (platform staff only,
// name-match confirmation required). Keeps the org shell + admin accounts.
adminRouter.post("/data/purge", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.actingOrgId) return forbidden(res, "Drill into the client workspace first.");
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { name: true } });
  if (!org) return res.status(404).send("Not found");
  if ((req.body?.confirmName || "") !== org.name) {
    return res.status(400).send(`The name you typed didn't match "${esc(org.name)}". Nothing was deleted. <a href="/admin/data">Back</a>.`);
  }
  await purgeOrgData(p.orgId);
  audit(req, p, "data.delete", { targetType: "Org", targetId: p.orgId, summary: `PURGED all data for ${org.name}` });
  res.redirect("/admin/data?done=1");
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

// Erase a single lead (GDPR/CCPA right to erasure).
adminRouter.post("/leads/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  const lead = await scopedLead(req, req.params.id);
  if (!lead) return res.status(404).send("Lead not found");
  await prisma.leadEvent.deleteMany({ where: { leadId: lead.id } });
  await prisma.lead.delete({ where: { id: lead.id } });
  audit(req, p, "data.delete", { targetType: "Lead", targetId: lead.id, summary: `erased lead: ${lead.name}` });
  res.redirect("/admin/leads");
});

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
  const csv = toCsv(rows);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
  res.send(csv);
});

// ---------- integrations: API keys + webhooks + SCIM ----------
// API keys and webhooks are per-org; only platform owners see across orgs.
async function renderIntegrations(res: any, p: RBAC.AdminPrincipal, newKey: string | null = null, newScimToken: string | null = null) {
  const orgFilter = RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId };
  const [keys, endpoints, saml, org, crmIntegrations, crmLocations] = await Promise.all([
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
    prisma.crmIntegration.findMany({
      where: orgFilter,
      orderBy: { createdAt: "desc" },
      include: { syncLogs: { orderBy: { updatedAt: "desc" }, take: 5 } },
    }),
    prisma.location.findMany({ where: orgFilter, orderBy: { name: "asc" }, select: { id: true, name: true } }),
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
      crmIntegrations,
      crmLocations,
    })
  );
}

adminRouter.get("/integrations", (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  return renderIntegrations(res, p);
});

// ---------- CRM / marketing sync (Phase 7.1) ----------
adminRouter.post("/crm", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  if (!(await ensureFeature(res, p.orgId, "crmSync", "CRM sync"))) return;
  const b = req.body || {};
  const name = clean(b.name);
  const provider = ["hubspot", "salesforce"].includes(b.provider) ? b.provider : "zapier";
  const endpoint = clean(b.endpoint); // zapier webhook URL
  const token = clean(b.token); // hubspot private-app token
  const sfOid = clean(b.sfOid); // salesforce org id (oid)
  const sfUrl = clean(b.sfUrl); // salesforce submission URL override (optional)
  if (!name) return res.redirect("/admin/integrations");
  if (provider === "zapier" && !endpoint) return res.redirect("/admin/integrations");
  if (provider === "hubspot" && !token) return res.redirect("/admin/integrations");
  if (provider === "salesforce" && !sfOid) return res.redirect("/admin/integrations");
  // Scope to a rooftop the admin can reach, or all rooftops in the org.
  let locationId: string | null = null;
  if (b.locationId) {
    const loc = await prisma.location.findFirst({ where: { id: String(b.locationId), orgId: p.orgId } });
    locationId = loc ? loc.id : null;
  }
  await prisma.crmIntegration.create({
    data: {
      orgId: p.orgId,
      provider,
      name,
      // endpoint = zapier webhook, or salesforce optional URL override.
      endpoint: provider === "zapier" ? endpoint : provider === "salesforce" ? sfUrl || null : null,
      // token = hubspot token, or salesforce oid.
      token: provider === "hubspot" ? token : provider === "salesforce" ? sfOid : null,
      fieldMap: parseFieldMapLines(b.fieldMap) as any,
      locationId,
      enabled: true,
    },
  });
  audit(req, p, "crm.create", { targetType: "CrmIntegration", summary: `${provider}: ${name}` });
  res.redirect("/admin/integrations");
});

adminRouter.post("/crm/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await prisma.crmIntegration.deleteMany({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
  });
  audit(req, p, "crm.delete", { targetType: "CrmIntegration", targetId: req.params.id });
  res.redirect("/admin/integrations");
});

adminRouter.post("/crm/:id/test", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await sendTestSync(req.params.id, p.orgId);
  res.redirect("/admin/integrations");
});

adminRouter.post("/crm/logs/:id/retry", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await retrySync(req.params.id, p.orgId);
  res.redirect("/admin/integrations");
});

// ---------- marketing: GA/GTM tags + campaign short links (Phase 7.4) ----------
adminRouter.get("/marketing", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const [org, campaigns] = await Promise.all([
    prisma.org.findUnique({ where: { id: p.orgId }, select: { gaMeasurementId: true, gtmContainerId: true } }),
    prisma.campaign.findMany({ where: { orgId: p.orgId }, orderBy: { createdAt: "desc" } }),
  ]);
  res.send(V.marketingView({ org: org || {}, campaigns, baseUrl: config.baseUrl }));
});

adminRouter.post("/marketing/tags", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const ga = clean(req.body?.gaMeasurementId);
  const gtm = clean(req.body?.gtmContainerId);
  await prisma.org.update({
    where: { id: p.orgId },
    data: {
      gaMeasurementId: ga && isGaId(ga) ? ga : null,
      gtmContainerId: gtm && isGtmId(gtm) ? gtm : null,
    },
  });
  res.redirect("/admin/marketing");
});

adminRouter.post("/marketing/campaigns", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const b = req.body || {};
  const name = clean(b.name);
  const landingUrl = clean(b.landingUrl);
  if (!name || !landingUrl || !/^https?:\/\//i.test(landingUrl)) return res.redirect("/admin/marketing");
  let code = normalizeCampaignCode(b.code) || normalizeCampaignCode(name);
  if (!code) code = "c" + Math.random().toString(36).slice(2, 8);
  // Ensure the short code is globally unique.
  if (await prisma.campaign.findUnique({ where: { code } })) code = `${code}-${Math.random().toString(36).slice(2, 6)}`;
  await prisma.campaign.create({
    data: {
      orgId: p.orgId,
      code,
      name,
      landingUrl,
      utmSource: clean(b.utmSource) || null,
      utmMedium: clean(b.utmMedium) || null,
      utmCampaign: clean(b.utmCampaign) || null,
    },
  });
  res.redirect("/admin/marketing");
});

adminRouter.post("/marketing/campaigns/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await prisma.campaign.deleteMany({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
  });
  res.redirect("/admin/marketing");
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
  audit(req, p, "apikey.create", { targetType: "ApiKey", summary: name });
  // Render directly (not a redirect) so the raw key never lands in a URL/log.
  await renderIntegrations(res, p, raw);
});

adminRouter.post("/api-keys/:id/revoke", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  // updateMany scoped by org so an admin can't revoke another org's key.
  await prisma.apiKey.updateMany({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
    data: { revoked: true },
  });
  audit(req, p, "apikey.revoke", { targetType: "ApiKey", targetId: req.params.id });
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
  audit(req, p, "webhook.create", { targetType: "WebhookEndpoint", summary: url });
  res.redirect("/admin/integrations");
});

adminRouter.post("/webhooks/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await prisma.webhookEndpoint.deleteMany({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
  });
  audit(req, p, "webhook.delete", { targetType: "WebhookEndpoint", targetId: req.params.id });
  res.redirect("/admin/integrations");
});

// Delivery inspector for one endpoint (org-scoped).
adminRouter.get("/webhooks/:id", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
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
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
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
  audit(req, p, "scim.token", { targetType: "Org", targetId: p.orgId });
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

  const jitEnabled = !!req.body?.jitEnabled;
  await prisma.samlConfig.upsert({
    where: { orgId: p.orgId },
    create: { orgId: p.orgId, enabled, entryPoint, idpIssuer, idpCert, jitEnabled },
    update: { enabled, entryPoint, idpIssuer, idpCert, jitEnabled },
  });
  audit(req, p, "sso.update", {
    targetType: "SamlConfig",
    targetId: p.orgId,
    summary: `${enabled ? "enabled" : "disabled"}${jitEnabled ? ", JIT on" : ""}`,
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
  // The client Admins form never touches OpenCard-staff (platform) accounts —
  // those are managed only in the Staff console.
  if (isPlatformRole(admin.role)) return null;
  if (!RBAC.seesAllOrgs(p) && admin.orgId !== p.orgId) return null;
  return admin;
}

adminRouter.get("/admins", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  // Only org-level admins here; platform accounts live in the Staff console.
  const admins = await prisma.adminUser.findMany({
    where: { ...(RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId }), role: { notIn: PLATFORM_ROLES_ALL } },
    orderBy: { createdAt: "asc" },
    include: { scopes: true },
  });
  res.send(V.adminsView(admins));
});
adminRouter.get("/admins/new", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const orgFilter = RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId };
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
  const orgFilter = RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId };
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

// The client Admins form only assigns org-level roles — platform (OpenCard-staff)
// roles are never grantable here; they're managed in the Staff console.
function safeRole(_p: RBAC.AdminPrincipal, role: string): string {
  return isPlatformRole(role) ? "org_admin" : role;
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
  audit(req, p, "admin.create", { targetType: "AdminUser", summary: `${email} (${data.role})` });
  // No password typed + invite requested: email a set-password link instead.
  if (!b.password && b.sendInvite) {
    const raw = await issueToken("invite", email);
    await sendMail(
      [email],
      "You've been invited to OpenCard",
      `${p.name} invited you to the OpenCard admin workspace.\n\n` +
        `Set your password here (link expires in 7 days):\n${config.baseUrl}/admin/invite?token=${raw}`
    );
    audit(req, p, "admin.invite_sent", { targetType: "AdminUser", summary: email });
  }
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
    data.recoveryCodes = Prisma.DbNull;
  }
  await prisma.$transaction([
    prisma.adminScope.deleteMany({ where: { adminUserId: target.id } }),
    prisma.adminUser.update({
      where: { id: target.id },
      data: { ...data, scopes: { create: scopeRowsFromBody(b) } },
    }),
  ]);
  // A changed password or deactivation kills the target's live sessions.
  if (b.password || !b.active) await revokeAllSessions(target.id);
  res.redirect("/admin/admins");
});

adminRouter.post("/admins/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageAdmins(p)) return forbidden(res);
  const target = await manageableAdmin(p, req.params.id);
  if (!target) return res.status(404).send("Not found");
  await prisma.adminUser.delete({ where: { id: target.id } });
  audit(req, p, "admin.delete", { targetType: "AdminUser", targetId: target.id, summary: target.email });
  res.redirect("/admin/admins");
});

// ---------- OpenCard staff (platform accounts; owner/admin only) ----------
// A staff target this actor may manage (must be a platform account + within tier).
async function manageableStaff(p: RBAC.AdminPrincipal, id: string) {
  const s = await prisma.adminUser.findUnique({ where: { id } });
  if (!s || !isPlatformRole(s.role) || !canManageStaffTarget(p.role, s.role)) return null;
  return s;
}

adminRouter.get("/staff", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.staffAdmin) return forbidden(res);
  const staff = await prisma.adminUser.findMany({
    where: { role: { in: PLATFORM_ROLES_ALL } },
    orderBy: { createdAt: "asc" },
  });
  res.send(V.staffListView(staff, p));
});

adminRouter.get("/staff/new", (req, res) => {
  const p = reqAdmin(req);
  if (!p.staffAdmin) return forbidden(res);
  res.send(V.staffForm(assignableStaffRoles(p.role)));
});

adminRouter.post("/staff", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.staffAdmin) return forbidden(res);
  const b = req.body;
  const email = String(b.email || "").toLowerCase().trim();
  const allowed = assignableStaffRoles(p.role);
  if (!email || !allowed.includes(b.role)) return res.redirect("/admin/staff/new");
  const data: any = { email, name: clean(b.name), role: b.role, orgId: null };
  if (b.password) data.passwordHash = hashPassword(String(b.password));
  await prisma.adminUser.create({ data });
  audit(req, p, "staff.create", { targetType: "AdminUser", summary: `${email} (${b.role})` });
  res.redirect("/admin/staff");
});

adminRouter.get("/staff/:id/edit", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.staffAdmin) return forbidden(res);
  const s = await manageableStaff(p, req.params.id);
  if (!s) return forbidden(res);
  res.send(V.staffForm(assignableStaffRoles(p.role), s));
});

adminRouter.post("/staff/:id", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.staffAdmin) return forbidden(res);
  const s = await manageableStaff(p, req.params.id);
  if (!s) return forbidden(res);
  const b = req.body;
  const data: any = { name: clean(b.name), active: !!b.active };
  if (assignableStaffRoles(p.role).includes(b.role)) data.role = b.role; // only grant assignable tiers
  if (b.password) data.passwordHash = hashPassword(String(b.password));
  if (b.resetMfa) {
    data.mfaEnabled = false;
    data.mfaSecret = null;
    data.recoveryCodes = Prisma.DbNull;
  }
  await prisma.adminUser.update({ where: { id: s.id }, data });
  if (b.password || !b.active) await revokeAllSessions(s.id);
  res.redirect("/admin/staff");
});

adminRouter.post("/staff/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.staffAdmin) return forbidden(res);
  const s = await manageableStaff(p, req.params.id);
  if (!s) return forbidden(res);
  if (p.email && s.email === p.email) return res.status(400).send("You can't delete your own account.");
  await prisma.adminUser.delete({ where: { id: s.id } });
  audit(req, p, "staff.delete", { targetType: "AdminUser", targetId: s.id, summary: s.email });
  res.redirect("/admin/staff");
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
