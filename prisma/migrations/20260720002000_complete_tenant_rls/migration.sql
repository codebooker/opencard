-- Complete database-enforced isolation for tenant-owned tables introduced
-- after the original RLS migration. The runtime tenant connection sees a row
-- only when runWithOrg has set app.current_org_id for its transaction.

ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Event"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Campaign"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "CrmIntegration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmIntegration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmIntegration"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "CrmSyncLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmSyncLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmSyncLog"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));

ALTER TABLE "TenantDomain" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantDomain" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantDomain"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));
