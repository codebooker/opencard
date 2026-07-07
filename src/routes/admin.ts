import { Router } from "express";
import { requireAdmin, reqAdmin } from "../middleware/auth";
import { prisma } from "../db";
import { page, esc } from "../views/html";
import { orgAccessState } from "../entitlements";
import { accessSummary } from "../access";
import { registerAuthRoutes } from "./admin/auth";
import { registerConsoleRoutes } from "./admin/console";
import { registerSecurityBillingRoutes } from "./admin/security_billing";
import { registerBrandingRoutes } from "./admin/branding";
import { registerCardRoutes } from "./admin/cards";
import { registerAnalyticsRoutes } from "./admin/analytics";
import { registerLeadRoutes } from "./admin/leads";
import { registerIntegrationRoutes } from "./admin/integrations";
import { registerAccountRoutes } from "./admin/accounts";

// The /admin surface, assembled from route-group modules under ./admin (CQ-05).
// Registration ORDER is load-bearing: pre-auth routes first, then the auth +
// MFA + access gates, then every authenticated group. Groups are registered in
// their original order for parity with the old single-file router.
export const adminRouter = Router();

// Nothing under /admin may be cached by browsers or CDNs. Cloudflare caches
// URLs by file EXTENSION by default — .pdf (ID badges) and .csv (exports) are
// on its list, which once served a stale authenticated badge from the edge
// cache. no-store closes both the staleness and the exposure.
adminRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

// ---- pre-auth (login, password reset, signup verify, invite) ----
registerAuthRoutes(adminRouter);

// everything below requires an admin principal (attached as req.admin)
adminRouter.use(requireAdmin);

// MFA enforcement for platform (OpenCard staff) accounts. These credentials can
// reach every tenant, billing, integrations, and destructive operations, so a
// stolen password alone must not be enough. Until the account enrolls TOTP, we
// confine it to the enrollment surface (and logout). Org/tenant admins keep
// self-service MFA (encouraged, not forced) so we don't lock customers out.
const MFA_EXEMPT_PATHS = new Set([
  "/logout",
  "/security",
  "/security/mfa/start",
  "/security/mfa/enable",
  "/security/mfa/recovery",
]);
adminRouter.use(async (req, res, next) => {
  const p = reqAdmin(req);
  if (!p.platform || !p.email) return next();
  if (MFA_EXEMPT_PATHS.has(req.path)) return next();
  const au = await prisma.adminUser.findUnique({
    where: { email: p.email },
    select: { mfaEnabled: true },
  });
  if (au?.mfaEnabled) return next();
  // Not enrolled yet. GET -> the security page (with a required-notice); any
  // other method -> block with a clear message.
  if (req.method === "GET") return res.redirect("/admin/security?mfa=required");
  return res.status(403).send(
    page({
      title: "Two-factor required",
      body: `<main class="card" style="max-width:520px"><section class="ident"><h1>Two-factor required</h1><p class="company">OpenCard staff accounts must enable two-factor authentication before making changes.</p></section><a class="cta" href="/admin/security">Set up two-factor</a></main>`,
    })
  );
});

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

// ---- authenticated route groups (original order) ----
registerConsoleRoutes(adminRouter);
registerSecurityBillingRoutes(adminRouter);
registerBrandingRoutes(adminRouter);
registerCardRoutes(adminRouter);
registerAnalyticsRoutes(adminRouter);
registerLeadRoutes(adminRouter);
registerIntegrationRoutes(adminRouter);
registerAccountRoutes(adminRouter);
