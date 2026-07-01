-- Phase 4, final: dealership asset types.
--
-- Non-employee QR/NFC assets (rooftop/department landings, desk/vehicle/service-
-- lane/event/campaign QRs). Public URL /a/:slug, scans counted. RLS parity with
-- other tenant tables (superuser bypasses).

CREATE TABLE "Asset" (
  "id"                TEXT NOT NULL,
  "orgId"             TEXT NOT NULL,
  "locationId"        TEXT NOT NULL,
  "type"              TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "slug"              TEXT NOT NULL,
  "destinationType"   TEXT NOT NULL DEFAULT 'landing',
  "destinationUrl"    TEXT,
  "destinationCardId" TEXT,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "scanCount"         INTEGER NOT NULL DEFAULT 0,
  "lastScanAt"        TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Asset_slug_key" ON "Asset"("slug");
CREATE INDEX "Asset_orgId_idx" ON "Asset"("orgId");
CREATE INDEX "Asset_locationId_idx" ON "Asset"("locationId");

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_destinationCardId_fkey" FOREIGN KEY ("destinationCardId") REFERENCES "Card"("id") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "Asset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Asset" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Asset"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));
