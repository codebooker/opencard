-- Self-serve domains hub: per-domain DNS verification status.
ALTER TABLE "TenantDomain"
  ADD COLUMN "verifyState" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3);
