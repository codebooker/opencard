import { Router } from "express";
import { requireAdmin } from "../middleware/auth";
import { registerAuthRoutes } from "./admin/auth";
import { registerConsoleRoutes } from "./admin/console";
import { registerSecurityRoutes } from "./admin/security";
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

// ---- pre-auth (login, password reset, invite) ----
registerAuthRoutes(adminRouter);

// everything below requires an admin principal (attached as req.admin)
adminRouter.use(requireAdmin);

// ---- authenticated route groups (original order) ----
registerConsoleRoutes(adminRouter);
registerSecurityRoutes(adminRouter);
registerBrandingRoutes(adminRouter);
registerCardRoutes(adminRouter);
registerAnalyticsRoutes(adminRouter);
registerLeadRoutes(adminRouter);
registerIntegrationRoutes(adminRouter);
registerAccountRoutes(adminRouter);
