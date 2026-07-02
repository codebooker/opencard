-- Phase 5, increment 4: lead lifecycle.
--
-- Lead assignment + duplicate linkage, and an append-only LeadEvent history for
-- status changes, reassignments (handoffs), and notes.

ALTER TABLE "Lead" ADD COLUMN "assignedTo"    TEXT;
ALTER TABLE "Lead" ADD COLUMN "duplicateOfId" TEXT;
ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Lead"("id") ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX "Lead_duplicateOfId_idx" ON "Lead"("duplicateOfId");

CREATE TABLE "LeadEvent" (
  "id"        TEXT NOT NULL,
  "leadId"    TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "fromValue" TEXT,
  "toValue"   TEXT,
  "actor"     TEXT,
  "note"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeadEvent_leadId_createdAt_idx" ON "LeadEvent"("leadId", "createdAt");
CREATE INDEX "LeadEvent_orgId_idx" ON "LeadEvent"("orgId");

ALTER TABLE "LeadEvent"
  ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "LeadEvent"
  ADD CONSTRAINT "LeadEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "LeadEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeadEvent"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));
