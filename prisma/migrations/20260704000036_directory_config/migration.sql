-- Per-org Azure AD / Entra credentials for the self-service directory import
-- wizard. Secret is stored encrypted (application-level AES-256-GCM).
CREATE TABLE "DirectoryConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DirectoryConfig_orgId_key" ON "DirectoryConfig"("orgId");

ALTER TABLE "DirectoryConfig" ADD CONSTRAINT "DirectoryConfig_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security, for parity with the other tenant tables.
ALTER TABLE "DirectoryConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DirectoryConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DirectoryConfig"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));
