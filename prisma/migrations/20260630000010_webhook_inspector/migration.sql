-- Phase 3: webhook delivery inspector.
--
-- Enrich WebhookDelivery so every attempt is fully inspectable and replayable:
-- attempt number, timing, the exact request payload + signature we sent, and the
-- response headers/body. All additive and nullable/defaulted, so it is safe on
-- existing data.

ALTER TABLE "WebhookDelivery" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WebhookDelivery" ADD COLUMN "durationMs" INTEGER;
ALTER TABLE "WebhookDelivery" ADD COLUMN "requestBody" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN "signature" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN "responseHeaders" JSONB;
ALTER TABLE "WebhookDelivery" ADD COLUMN "responseBody" TEXT;
