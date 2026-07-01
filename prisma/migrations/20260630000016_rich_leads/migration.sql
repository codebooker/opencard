-- Phase 5, increment 1: rich leads + attribution.
--
-- Adds dealership lead fields, a consent flag, a lifecycle status, and source/
-- attribution columns to Lead. All additive with defaults, so existing rows are
-- unaffected (status backfills to 'new').

ALTER TABLE "Lead" ADD COLUMN "preferredContact"   TEXT;
ALTER TABLE "Lead" ADD COLUMN "vehicleInterest"    TEXT;
ALTER TABLE "Lead" ADD COLUMN "tradeIn"            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "serviceNeed"        TEXT;
ALTER TABLE "Lead" ADD COLUMN "appointmentRequest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "consent"            BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "status"             TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "Lead" ADD COLUMN "campaign"           TEXT;
ALTER TABLE "Lead" ADD COLUMN "utmSource"          TEXT;
ALTER TABLE "Lead" ADD COLUMN "utmMedium"          TEXT;
ALTER TABLE "Lead" ADD COLUMN "utmCampaign"        TEXT;
ALTER TABLE "Lead" ADD COLUMN "referrer"           TEXT;
ALTER TABLE "Lead" ADD COLUMN "device"             TEXT;

CREATE INDEX "Lead_status_idx" ON "Lead"("status");
