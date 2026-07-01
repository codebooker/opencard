-- Phase 3: per-tenant SCIM tokens. Only the SHA-256 hash is stored.
ALTER TABLE "Org" ADD COLUMN "scimTokenHash" TEXT;
CREATE UNIQUE INDEX "Org_scimTokenHash_key" ON "Org"("scimTokenHash");
