-- ID card printing as a paid add-on (per client) + per-brand back design.
ALTER TABLE "Org" ADD COLUMN "idCardsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Brand" ADD COLUMN "idCardBack" TEXT NOT NULL DEFAULT 'cubes';
