-- Phase 7.4: per-org marketing analytics tags + trackable campaign short links.

ALTER TABLE "Org"
  ADD COLUMN "gaMeasurementId" TEXT,
  ADD COLUMN "gtmContainerId" TEXT;

CREATE TABLE "Campaign" (
  "id"          TEXT NOT NULL,
  "orgId"       TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "landingUrl"  TEXT NOT NULL,
  "utmSource"   TEXT,
  "utmMedium"   TEXT,
  "utmCampaign" TEXT,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "clicks"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Campaign_code_key" ON "Campaign"("code");
CREATE INDEX "Campaign_orgId_idx" ON "Campaign"("orgId");
ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
