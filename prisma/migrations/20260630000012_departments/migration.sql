-- Phase 4, increment 2a: departments within a rooftop.
--
-- A Department belongs to a rooftop (Location) and carries its own CTAs that
-- override the rooftop's on cards assigned to it. Cards gain an optional
-- departmentId. RLS parity with other tenant tables (superuser bypasses).

CREATE TABLE "Department" (
  "id"         TEXT NOT NULL,
  "orgId"      TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "ctas"       JSONB NOT NULL DEFAULT '[]',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Department_locationId_name_key" ON "Department"("locationId", "name");
CREATE INDEX "Department_orgId_idx" ON "Department"("orgId");

ALTER TABLE "Department"
  ADD CONSTRAINT "Department_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "Department"
  ADD CONSTRAINT "Department_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON UPDATE CASCADE ON DELETE CASCADE;

-- Card -> Department (optional).
ALTER TABLE "Card" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "Card"
  ADD CONSTRAINT "Card_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- Row-Level Security.
ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Department"
  USING ("orgId" = current_setting('app.current_org_id', true))
  WITH CHECK ("orgId" = current_setting('app.current_org_id', true));
