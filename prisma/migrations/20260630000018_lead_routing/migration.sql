-- Phase 5, increment 3: lead routing.
--
-- Rooftop lead inbox + campaign->email overrides, and a per-department inbox.
-- All additive/nullable.

ALTER TABLE "Location"   ADD COLUMN "leadEmail"       TEXT;
ALTER TABLE "Location"   ADD COLUMN "campaignRouting" JSONB;
ALTER TABLE "Department" ADD COLUMN "leadEmail"       TEXT;
