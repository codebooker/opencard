// Database-aware entitlement checks built on the pure plan engine in ./plans.
import { prisma } from "./db";
import { Feature, LimitKey, hasFeature, withinLimit } from "./plans";

export async function orgPlanKey(orgId: string): Promise<string> {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { plan: true } });
  return org?.plan ?? "starter";
}

export async function orgHasFeature(orgId: string, feature: Feature): Promise<boolean> {
  return hasFeature(await orgPlanKey(orgId), feature);
}

// How many of each limited resource the org currently uses.
const counters: Record<LimitKey, (orgId: string) => Promise<number>> = {
  brands: (o) => prisma.brand.count({ where: { orgId: o } }),
  locations: (o) => prisma.location.count({ where: { orgId: o } }),
  cards: (o) => prisma.card.count({ where: { orgId: o } }),
  admins: (o) => prisma.adminUser.count({ where: { orgId: o } }),
  apiKeys: (o) => prisma.apiKey.count({ where: { orgId: o, revoked: false } }),
  customDomains: async (o) => {
    const org = await prisma.org.findUnique({ where: { id: o }, select: { customDomain: true } });
    return org?.customDomain ? 1 : 0;
  },
};

// True if the org may create one more of `key` under its current plan.
export async function canAdd(orgId: string, key: LimitKey): Promise<boolean> {
  const [plan, count] = await Promise.all([orgPlanKey(orgId), counters[key](orgId)]);
  return withinLimit(plan, key, count);
}

export async function orgUsage(orgId: string): Promise<Record<LimitKey, number>> {
  const keys: LimitKey[] = ["brands", "locations", "cards", "admins", "apiKeys", "customDomains"];
  const entries = await Promise.all(keys.map(async (k) => [k, await counters[k](orgId)] as const));
  return Object.fromEntries(entries) as Record<LimitKey, number>;
}
