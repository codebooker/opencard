-- Branded login: map a hostname to a tenant scope (brand-wide or rooftop override).

CREATE TABLE "TenantDomain" (
  "id"         TEXT NOT NULL,
  "host"       TEXT NOT NULL,
  "orgId"      TEXT NOT NULL,
  "brandId"    TEXT,
  "locationId" TEXT,
  "approved"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantDomain_host_key" ON "TenantDomain"("host");
CREATE INDEX "TenantDomain_orgId_idx" ON "TenantDomain"("orgId");
CREATE INDEX "TenantDomain_brandId_idx" ON "TenantDomain"("brandId");
CREATE INDEX "TenantDomain_locationId_idx" ON "TenantDomain"("locationId");

ALTER TABLE "TenantDomain"
  ADD CONSTRAINT "TenantDomain_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TenantDomain"
  ADD CONSTRAINT "TenantDomain_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantDomain"
  ADD CONSTRAINT "TenantDomain_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
