-- Phase 4, increment 2b: role templates.
--
-- Extends Template with role-preset behaviors: locked/hidden fields, role CTAs,
-- lead-capture toggle, disclaimer, QR override, and an email signature block.
-- All additive with sensible defaults, so existing templates are unchanged.

ALTER TABLE "Template" ADD COLUMN "role" TEXT;
ALTER TABLE "Template" ADD COLUMN "lockedFields" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Template" ADD COLUMN "hiddenFields" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Template" ADD COLUMN "roleCtas" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Template" ADD COLUMN "leadCapture" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Template" ADD COLUMN "disclaimer" TEXT;
ALTER TABLE "Template" ADD COLUMN "showQr" BOOLEAN;
ALTER TABLE "Template" ADD COLUMN "emailSignature" TEXT;
