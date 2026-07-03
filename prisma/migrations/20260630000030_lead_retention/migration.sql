-- Phase 9.3: per-org lead retention policy (auto-prune leads older than N days).
ALTER TABLE "Org" ADD COLUMN "leadRetentionDays" INTEGER;
