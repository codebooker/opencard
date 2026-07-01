-- Phase 4, increment 1: dealership rooftop profile.
--
-- Adds dealership identity + CTA fields to Location (rooftop). All additive and
-- nullable/defaulted, so it is safe on existing data.

ALTER TABLE "Location" ADD COLUMN "oemBrands" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Location" ADD COLUMN "phone" TEXT;
ALTER TABLE "Location" ADD COLUMN "website" TEXT;
ALTER TABLE "Location" ADD COLUMN "salesUrl" TEXT;
ALTER TABLE "Location" ADD COLUMN "serviceUrl" TEXT;
ALTER TABLE "Location" ADD COLUMN "timezone" TEXT;
