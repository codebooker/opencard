import { prisma } from "./db";
import { stripKeys, stripRows } from "./dataexport";

// Assemble a full data-portability bundle for one org (GDPR/CCPA export).
// Secrets and integration credentials are stripped before export.
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
    org: stripKeys(org, ["scimTokenHash"]),
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
