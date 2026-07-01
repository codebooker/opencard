-- Phase 3: API key permission scopes + last-used route.
-- Existing keys get an empty scope list, which is treated as full access, so they
-- keep working exactly as before.
ALTER TABLE "ApiKey" ADD COLUMN "scopes" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ApiKey" ADD COLUMN "lastUsedPath" TEXT;
