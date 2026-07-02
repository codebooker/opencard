import { prisma } from "./db";
import { analyticsSnippet } from "./marketing";

// Resolve an org's GA4 / GTM <head> snippet (empty when none configured).
export async function orgAnalyticsHead(orgId: string): Promise<string> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { gaMeasurementId: true, gtmContainerId: true },
  });
  return analyticsSnippet(org?.gaMeasurementId, org?.gtmContainerId);
}
