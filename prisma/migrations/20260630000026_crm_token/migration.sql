-- Phase 7.2: API auth token for token-based CRM providers (HubSpot private-app token).
ALTER TABLE "CrmIntegration" ADD COLUMN "token" TEXT;
