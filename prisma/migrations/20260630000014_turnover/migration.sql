-- Phase 4, increment 3: turnover / offboarding.
--
-- A deactivated card can redirect its public URL to a manager's card or the
-- rooftop site, so previously-printed NFC/QR cards still resolve. Additive.

ALTER TABLE "Card" ADD COLUMN "redirectUrl" TEXT;
