-- Phase 10.2: time-bounded events that group QR assets + their leads.

CREATE TABLE "Event" (
  "id"         TEXT NOT NULL,
  "orgId"      TEXT NOT NULL,
  "locationId" TEXT,
  "name"       TEXT NOT NULL,
  "startsAt"   TIMESTAMP(3),
  "endsAt"     TIMESTAMP(3),
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Event_orgId_idx" ON "Event"("orgId");
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Asset" ADD COLUMN "eventId" TEXT;
CREATE INDEX "Asset_eventId_idx" ON "Asset"("eventId");
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
