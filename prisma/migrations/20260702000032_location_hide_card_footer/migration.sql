-- Per-store toggle: hide the "Brand · Store" footer on public cards and asset landings.
ALTER TABLE "Location" ADD COLUMN "hideCardFooter" BOOLEAN NOT NULL DEFAULT false;
