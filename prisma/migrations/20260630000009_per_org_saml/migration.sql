-- Phase 3: per-org SAML SSO.
--
-- Moves the single global SamlConfig (id = "default") to one config per org,
-- keyed by a unique "orgId". The SP entityID and ACS URL are now DERIVED from
-- each org's canonical host (subdomain / custom domain) rather than stored, so
-- the "issuer" column is dropped. RLS is added for parity with other tenant
-- tables (the superuser that runs migrations/seed bypasses it).

-- 1. Add orgId (nullable for backfill).
ALTER TABLE "SamlConfig" ADD COLUMN "orgId" TEXT;

-- 2. Assign any existing global config to the earliest org; discard otherwise.
UPDATE "SamlConfig"
SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "orgId" IS NULL;
DELETE FROM "SamlConfig" WHERE "orgId" IS NULL;

-- 3. Drop the now-derived SP issuer column.
ALTER TABLE "SamlConfig" DROP COLUMN IF EXISTS "issuer";

-- 4. Enforce exactly one config per org.
ALTER TABLE "SamlConfig" ALTER COLUMN "orgId" SET NOT NULL;
CREATE UNIQUE INDEX "SamlConfig_orgId_key" ON "SamlConfig"("orgId");
ALTER TABLE "SamlConfig"
  ADD CONSTRAINT "SamlConfig_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Row-Level Security (owner/superuser bypasses; runtime app role is scoped).
ALTER TABLE "SamlConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SamlConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SamlConfig"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));
