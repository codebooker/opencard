-- Phase 2: account billing mode.
--   standard — normal Stripe-billed customer (trial then subscription)
--   demo     — time-limited free comp; locks when trialEndsAt passes
--   free     — permanent comp (friends/family), never locked
ALTER TABLE "Org" ADD COLUMN "billingMode" TEXT NOT NULL DEFAULT 'standard';
