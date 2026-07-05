-- New plan lineup: individual / team / multi_location_brand / enterprise.
-- Remap legacy keys and change column defaults.

ALTER TABLE "Org" ALTER COLUMN "plan" SET DEFAULT 'individual';
ALTER TABLE "PlatformConfig" ALTER COLUMN "signupPlan" SET DEFAULT 'individual';

UPDATE "Org" SET "plan" = 'individual' WHERE "plan" = 'starter';
UPDATE "Org" SET "plan" = 'multi_location_brand' WHERE "plan" = 'dealer_group';
UPDATE "PlatformConfig" SET "signupPlan" = 'individual' WHERE "signupPlan" = 'starter';
UPDATE "PlatformConfig" SET "signupPlan" = 'multi_location_brand' WHERE "signupPlan" = 'dealer_group';
