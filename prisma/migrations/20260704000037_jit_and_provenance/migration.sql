-- SAML JIT provisioning toggle + provisioning provenance for the sync
-- health dashboard.
ALTER TABLE "SamlConfig" ADD COLUMN "jitEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "provisionedBy" TEXT;

-- Backfill what we can infer: users with a scimId were provisioned via SCIM.
UPDATE "User" SET "provisionedBy" = 'scim' WHERE "scimId" IS NOT NULL;
