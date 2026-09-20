// Authoritative allowlist for the least-privilege tenant database connection.
// Every entry must have an orgId-based RLS policy. A schema regression test
// keeps this list, Prisma models, and committed migrations in sync.
export const TENANT_TABLES = [
  "AnalyticsEvent",
  "ApiKey",
  "Asset",
  "AuditLog",
  "Brand",
  "Campaign",
  "Card",
  "CrmIntegration",
  "CrmSyncLog",
  "Department",
  "DirectoryConfig",
  "Event",
  "Lead",
  "LeadEvent",
  "Location",
  "SamlConfig",
  "Template",
  "TenantDomain",
  "User",
  "WebhookDelivery",
  "WebhookEndpoint",
] as const;
