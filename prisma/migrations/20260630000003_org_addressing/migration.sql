-- Phase 1, increment 3: tenant addressing fields for future host-based routing.
-- Both nullable + unique. In Postgres a unique index permits multiple NULLs, so
-- existing orgs (which have neither set) are unaffected.

ALTER TABLE "Org" ADD COLUMN "subdomain" TEXT;
ALTER TABLE "Org" ADD COLUMN "customDomain" TEXT;

CREATE UNIQUE INDEX "Org_subdomain_key" ON "Org"("subdomain");
CREATE UNIQUE INDEX "Org_customDomain_key" ON "Org"("customDomain");
