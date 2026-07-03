import { prisma } from "./db";
import { stripKeys, stripRows } from "./dataexport";

// Assemble a full data-portability bundle for one org (GDPR/CCPA export).
// Secrets (tokens, Stripe/SCIM identifiers) are stripped before export.
export async function buildOrgExport(orgId: string): Promise<any> {
  const [org, brands, locations, departments, cards, users, leads, assets, campaigns, domains, crm, auditCount] =
    await Promise.all([
      prisma.org.findUnique({ where: { id: orgId } }),
      prisma.brand.findMany({ where: { orgId } }),
      prisma.location.findMany({ where: { orgId } }),
      prisma.department.findMany({ where: { orgId } }),
      prisma.card.findMany({ where: { orgId } }),
      prisma.user.findMany({ where: { orgId } }),
      prisma.lead.findMany({ where: { orgId } }),
      prisma.asset.findMany({ where: { orgId } }),
      prisma.campaign.findMany({ where: { orgId } }),
      prisma.tenantDomain.findMany({ where: { orgId } }),
      prisma.crmIntegration.findMany({ where: { orgId } }),
      prisma.auditLog.count({ where: { orgId } }),
    ]);
  return {
    exportedAt: new Date().toISOString(),
    org: stripKeys(org, ["scimTokenHash", "stripeCustomerId", "stripeSubscriptionId"]),
    counts: {
      brands: brands.length,
      locations: locations.length,
      departments: departments.length,
      cards: cards.length,
      users: users.length,
      leads: leads.length,
      assets: assets.length,
      campaigns: campaigns.length,
      domains: domains.length,
      auditLogEntries: auditCount,
    },
    brands,
    locations,
    departments,
    cards,
    users,
    leads,
    assets,
    campaigns,
    domains,
    crmIntegrations: stripRows(crm, ["token"]),
  };
}

// Erase all operational/customer data for an org (right to erasure). Keeps the Org
// shell + admin accounts. FK-safe order. Platform-only; heavily guarded upstream.
export async function purgeOrgData(orgId: string): Promise<void> {
  await prisma.leadEvent.deleteMany({ where: { orgId } });
  await prisma.lead.deleteMany({ where: { orgId } });
  await prisma.analyticsEvent.deleteMany({ where: { orgId } });
  await prisma.crmSyncLog.deleteMany({ where: { orgId } });
  await prisma.crmIntegration.deleteMany({ where: { orgId } });
  await prisma.campaign.deleteMany({ where: { orgId } });
  await prisma.tenantDomain.deleteMany({ where: { orgId } });
  await prisma.webhookDelivery.deleteMany({ where: { orgId } });
  await prisma.webhookEndpoint.deleteMany({ where: { orgId } });
  await prisma.apiKey.deleteMany({ where: { orgId } });
  await prisma.samlConfig.deleteMany({ where: { orgId } });
  await prisma.asset.deleteMany({ where: { orgId } });
  await prisma.card.deleteMany({ where: { orgId } });
  await prisma.template.deleteMany({ where: { orgId } });
  await prisma.department.deleteMany({ where: { orgId } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.location.deleteMany({ where: { orgId } });
  await prisma.brand.deleteMany({ where: { orgId } });
}
