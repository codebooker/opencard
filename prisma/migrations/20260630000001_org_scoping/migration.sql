-- Phase 1: tenant scoping. Add orgId to all tenant-owned models.
-- Strategy per table: add nullable column, backfill from the existing org
-- (single-tenant today; a no-op on a fresh database with no rows), then enforce
-- NOT NULL + foreign key + index. End state matches the Prisma schema.

-- Helper expression used for backfill: the (single) existing org.
--   (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1)

-- ---- Location ----
ALTER TABLE "Location" ADD COLUMN "orgId" TEXT;
UPDATE "Location" SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "Location" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "Location_orgId_idx" ON "Location"("orgId");
ALTER TABLE "Location" ADD CONSTRAINT "Location_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Template ----
ALTER TABLE "Template" ADD COLUMN "orgId" TEXT;
UPDATE "Template" SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "Template" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "Template_orgId_idx" ON "Template"("orgId");
ALTER TABLE "Template" ADD CONSTRAINT "Template_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- User ----
ALTER TABLE "User" ADD COLUMN "orgId" TEXT;
UPDATE "User" SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "User" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "User_orgId_idx" ON "User"("orgId");
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Card ----
ALTER TABLE "Card" ADD COLUMN "orgId" TEXT;
UPDATE "Card" SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "Card" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "Card_orgId_idx" ON "Card"("orgId");
ALTER TABLE "Card" ADD CONSTRAINT "Card_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- AnalyticsEvent ----
ALTER TABLE "AnalyticsEvent" ADD COLUMN "orgId" TEXT;
UPDATE "AnalyticsEvent" SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "AnalyticsEvent" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "AnalyticsEvent_orgId_idx" ON "AnalyticsEvent"("orgId");
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Lead ----
ALTER TABLE "Lead" ADD COLUMN "orgId" TEXT;
UPDATE "Lead" SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "Lead" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "Lead_orgId_idx" ON "Lead"("orgId");
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- ApiKey ----
ALTER TABLE "ApiKey" ADD COLUMN "orgId" TEXT;
UPDATE "ApiKey" SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "ApiKey" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "ApiKey_orgId_idx" ON "ApiKey"("orgId");
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- WebhookEndpoint ----
ALTER TABLE "WebhookEndpoint" ADD COLUMN "orgId" TEXT;
UPDATE "WebhookEndpoint" SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "WebhookEndpoint" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "WebhookEndpoint_orgId_idx" ON "WebhookEndpoint"("orgId");
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- WebhookDelivery ----
ALTER TABLE "WebhookDelivery" ADD COLUMN "orgId" TEXT;
UPDATE "WebhookDelivery" SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1);
ALTER TABLE "WebhookDelivery" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "WebhookDelivery_orgId_idx" ON "WebhookDelivery"("orgId");
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
