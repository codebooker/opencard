-- A self-hosted installation owns exactly one workspace. Do not silently
-- collapse or delete client data from an older multi-company installation.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "Org") > 1 THEN
    RAISE EXCEPTION 'OpenCard single-workspace migration stopped: more than one Org exists. Export/migrate those workspaces separately before upgrading.';
  END IF;
END $$;

-- Convert legacy platform accounts into owners of the local workspace.
UPDATE "AdminUser"
SET "role" = 'org_owner',
    "orgId" = COALESCE("orgId", (SELECT "id" FROM "Org" LIMIT 1))
WHERE "role" IN ('platform_owner', 'platform_admin', 'platform_staff', 'super_admin');

DROP TABLE IF EXISTS "PlatformConfig";

ALTER TABLE "Org"
  DROP COLUMN IF EXISTS "suspended",
  DROP COLUMN IF EXISTS "tosAcceptedAt",
  DROP COLUMN IF EXISTS "tosVersion",
  DROP COLUMN IF EXISTS "ownerVerifiedAt",
  DROP COLUMN IF EXISTS "idCardsEnabled",
  DROP COLUMN IF EXISTS "plan",
  DROP COLUMN IF EXISTS "seatLimit",
  DROP COLUMN IF EXISTS "billingMode",
  DROP COLUMN IF EXISTS "subscriptionStatus",
  DROP COLUMN IF EXISTS "trialEndsAt",
  DROP COLUMN IF EXISTS "currentPeriodEnd",
  DROP COLUMN IF EXISTS "cancelAtPeriodEnd",
  DROP COLUMN IF EXISTS "stripeCustomerId",
  DROP COLUMN IF EXISTS "stripeSubscriptionId";
