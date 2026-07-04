-- First-run onboarding checklist (Phase 14): dismissible per org.
ALTER TABLE "Org" ADD COLUMN "onboardingDismissedAt" TIMESTAMP(3);

-- Existing orgs predate the checklist — don't greet veterans with a tutorial.
UPDATE "Org" SET "onboardingDismissedAt" = CURRENT_TIMESTAMP;
