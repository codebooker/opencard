-- Phase 7.1: per-org CRM / marketing sync integrations + per-lead sync logs.

CREATE TABLE "CrmIntegration" (
  "id"          TEXT NOT NULL,
  "orgId"       TEXT NOT NULL,
  "provider"    TEXT NOT NULL DEFAULT 'zapier',
  "name"        TEXT NOT NULL,
  "enabled"     BOOLEAN NOT NULL DEFAULT true,
  "endpoint"    TEXT,
  "fieldMap"    JSONB NOT NULL DEFAULT '{}',
  "locationId"  TEXT,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmIntegration_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CrmIntegration_orgId_idx" ON "CrmIntegration"("orgId");
ALTER TABLE "CrmIntegration"
  ADD CONSTRAINT "CrmIntegration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CrmSyncLog" (
  "id"            TEXT NOT NULL,
  "orgId"         TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "leadId"        TEXT NOT NULL,
  "provider"      TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "responseCode"  INTEGER,
  "lastError"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmSyncLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CrmSyncLog_orgId_idx" ON "CrmSyncLog"("orgId");
CREATE INDEX "CrmSyncLog_integrationId_idx" ON "CrmSyncLog"("integrationId");
CREATE INDEX "CrmSyncLog_status_idx" ON "CrmSyncLog"("status");
ALTER TABLE "CrmSyncLog"
  ADD CONSTRAINT "CrmSyncLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmSyncLog"
  ADD CONSTRAINT "CrmSyncLog_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "CrmIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
