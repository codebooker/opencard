-- Per-store toggle: the store name + OEM badges above the dealership CTA
-- buttons on public cards. Hidden by default — the same information already
-- appears in the card footer. The CTA buttons themselves are unaffected.
ALTER TABLE "Location" ADD COLUMN "hideDealerHeader" BOOLEAN NOT NULL DEFAULT true;
