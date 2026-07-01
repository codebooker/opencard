-- Phase 5, increment 2: configurable lead forms + asset lead capture.
--
-- Per-template/brand lead-form config (which fields show + consent text), and
-- leads that can originate from an asset landing page (not just a card).

-- Configurable lead form (null = inherit / default).
ALTER TABLE "Template" ADD COLUMN "leadFields"      JSONB;
ALTER TABLE "Template" ADD COLUMN "leadConsentText" TEXT;
ALTER TABLE "Brand"    ADD COLUMN "leadFields"      JSONB;
ALTER TABLE "Brand"    ADD COLUMN "leadConsentText" TEXT;

-- A lead may now come from an asset instead of a card.
ALTER TABLE "Lead" ALTER COLUMN "cardId" DROP NOT NULL;
ALTER TABLE "Lead" ADD COLUMN "assetId" TEXT;
ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX "Lead_assetId_idx" ON "Lead"("assetId");
