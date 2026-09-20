-- Employee identities belong to a workspace. The previous global unique
-- indexes prevented the same email/directory object from appearing in two
-- independent tenants.
DROP INDEX "User_email_key";
DROP INDEX "User_externalId_key";
DROP INDEX "User_scimId_key";

CREATE UNIQUE INDEX "User_orgId_email_key" ON "User"("orgId", "email");
CREATE UNIQUE INDEX "User_orgId_externalId_key" ON "User"("orgId", "externalId");
CREATE UNIQUE INDEX "User_orgId_scimId_key" ON "User"("orgId", "scimId");
