-- Platform-staff kill switch for a client workspace.
ALTER TABLE "Org" ADD COLUMN "suspended" BOOLEAN NOT NULL DEFAULT false;
