-- Phase 6.2: per-rooftop signature design + governance, brand-wide campaign banner.

ALTER TABLE "Location"
  ADD COLUMN "signatureTheme" TEXT NOT NULL DEFAULT 'classic',
  ADD COLUMN "signatureDisclaimer" TEXT,
  ADD COLUMN "signatureLocks" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "Brand"
  ADD COLUMN "signatureBannerText" TEXT,
  ADD COLUMN "signatureBannerHref" TEXT,
  ADD COLUMN "signatureBannerStart" TIMESTAMP(3),
  ADD COLUMN "signatureBannerEnd" TIMESTAMP(3);
