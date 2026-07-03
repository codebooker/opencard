-- Phase 8.3: scheduled manager digest settings per org.
ALTER TABLE "Org"
  ADD COLUMN "digestEmails" TEXT,
  ADD COLUMN "digestCadence" TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN "digestLastSentAt" TIMESTAMP(3);
