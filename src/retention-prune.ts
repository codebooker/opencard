import { prisma } from "./db";
import { retentionCutoff } from "./retention";
import { recordAudit } from "./audit-log";

// Delete leads older than an org's retention cutoff (+ their events). Audited.
export async function pruneOrgLeads(orgId: string, days: number | null | undefined): Promise<number> {
  const cutoff = retentionCutoff(days);
  if (!cutoff) return 0;
  const old = await prisma.lead.findMany({ where: { orgId, createdAt: { lt: cutoff } }, select: { id: true } });
  if (!old.length) return 0;
  const ids = old.map((l) => l.id);
  await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { id: { in: ids } } });
  recordAudit({
    orgId,
    actor: { role: "system" },
    action: "data.retention",
    targetType: "Lead",
    summary: `retention: pruned ${ids.length} lead(s) older than ${days}d`,
  });
  return ids.length;
}

// Scheduler tick: prune every org that has a retention policy set.
export async function pruneExpiredLeads(): Promise<number> {
  const orgs = await prisma.org.findMany({
    where: { leadRetentionDays: { gt: 0 } },
    select: { id: true, leadRetentionDays: true },
  });
  let total = 0;
  for (const o of orgs) total += await pruneOrgLeads(o.id, o.leadRetentionDays).catch(() => 0);
  return total;
}
