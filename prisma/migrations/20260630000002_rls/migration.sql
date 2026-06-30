-- Phase 1, increment 2: database-enforced tenant isolation (Row-Level Security).
--
-- Each tenant-owned table gets a policy that only exposes rows whose "orgId"
-- matches the per-transaction setting `app.current_org_id`. The application sets
-- that setting (via SET LOCAL / set_config) at the start of every tenant-scoped
-- transaction while connected as the least-privilege role `opencard_app`.
--
-- Notes:
--   * current_setting('app.current_org_id', true) returns NULL when unset
--     (missing_ok = true), so a connection with no tenant context sees no rows.
--   * ENABLE makes the policy apply to non-owner roles (the runtime app role).
--   * FORCE also applies it to the table owner, as defense-in-depth. Migrations
--     and seed run as the database SUPERUSER, which bypasses RLS entirely, so
--     they are unaffected by these policies.

-- Reusable predicate (inlined per table): "orgId" = current_setting('app.current_org_id', true)

-- ---- Brand ----
ALTER TABLE "Brand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Brand" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Brand"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ---- Location ----
ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Location" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Location"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ---- Template ----
ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Template" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Template"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ---- User ----
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ---- Card ----
ALTER TABLE "Card" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Card" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Card"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ---- AnalyticsEvent ----
ALTER TABLE "AnalyticsEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnalyticsEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AnalyticsEvent"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ---- Lead ----
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Lead"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ---- ApiKey ----
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApiKey"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ---- WebhookEndpoint ----
ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEndpoint" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebhookEndpoint"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

-- ---- WebhookDelivery ----
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebhookDelivery"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));
