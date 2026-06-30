-- Phase 1, increment 4: scope admin accounts to an org.
-- orgId is nullable: NULL marks a platform-level admin that spans all orgs.
-- Existing admins are backfilled to the single existing org so they keep working.

ALTER TABLE "AdminUser" ADD COLUMN "orgId" TEXT;
UPDATE "AdminUser" SET "orgId" = (SELECT "id" FROM "Org" ORDER BY "createdAt" ASC LIMIT 1);
CREATE INDEX "AdminUser_orgId_idx" ON "AdminUser"("orgId");
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;
