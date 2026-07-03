-- Phase 9.1: append-only audit trail of security/compliance-relevant actions.

CREATE TABLE "AuditLog" (
  "id"         TEXT NOT NULL,
  "orgId"      TEXT NOT NULL,
  "actorEmail" TEXT,
  "actorRole"  TEXT,
  "action"     TEXT NOT NULL,
  "targetType" TEXT,
  "targetId"   TEXT,
  "summary"    TEXT,
  "ip"         TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
