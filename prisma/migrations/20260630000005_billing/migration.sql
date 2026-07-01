-- Phase 2: billing / plan state on the tenant.
-- New columns have safe defaults. Existing orgs (the demo/dev data) are moved to
-- a full plan so their already-configured SSO/SCIM/webhooks keep working; brand
-- new signups start on "starter" via the column default.

ALTER TABLE "Org" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'starter';
ALTER TABLE "Org" ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'trialing';
ALTER TABLE "Org" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Org" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Org" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Org" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Org" ADD COLUMN "stripeSubscriptionId" TEXT;

-- Grandfather existing tenants onto the full plan.
UPDATE "Org" SET "plan" = 'dealer_group', "subscriptionStatus" = 'active';

CREATE UNIQUE INDEX "Org_stripeCustomerId_key" ON "Org"("stripeCustomerId");
CREATE UNIQUE INDEX "Org_stripeSubscriptionId_key" ON "Org"("stripeSubscriptionId");
