-- Instant lead alerts to a Slack / Teams incoming webhook (Phase 14).
ALTER TABLE "Org" ADD COLUMN "leadWebhookUrl" TEXT;
