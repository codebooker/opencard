import { prisma } from "./db";
import { resolveRange, conversionPct, sortLeaderboard, buildFunnel, topGroups } from "./analytics";
import { assetTypeLabel } from "./assets";
import { toCsv } from "./csv";
import { buildDigest, digestDue, parseDigestEmails } from "./digest";
import { sendMail } from "./notify";

// Org-wide analytics aggregation (all locations/cards/leads in the org), reused by
// the CSV export and the manager digest. Mirrors the dashboard route's math.
export async function computeOrgAnalytics(orgId: string, rangeKey: unknown) {
  const range = resolveRange(rangeKey);
  const since = range.since;
  const [cards, assets, departments, locations] = await Promise.all([
    prisma.card.findMany({ where: { orgId }, select: { id: true, locationId: true, departmentId: true, firstName: true, lastName: true } }),
    prisma.asset.findMany({ where: { orgId }, select: { id: true, locationId: true, type: true } }),
    prisma.department.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.location.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  const cardIds = cards.map((c) => c.id);
  const whereEvents = { cardId: { in: cardIds }, ...(since ? { createdAt: { gte: since } } : {}) };
  const leadWhere = { orgId, ...(since ? { createdAt: { gte: since } } : {}) };
  const [grouped, viewsByCard, leadsInRange, scanAgg, leadCount] = await Promise.all([
    prisma.analyticsEvent.groupBy({ by: ["type"], where: whereEvents, _count: { _all: true } }),
    prisma.analyticsEvent.groupBy({ by: ["cardId"], where: { type: "view", ...whereEvents }, _count: { _all: true } }),
    prisma.lead.findMany({ where: leadWhere, select: { cardId: true, assetId: true, status: true, campaign: true, utmCampaign: true, utmSource: true } }),
    prisma.asset.aggregate({ where: { orgId }, _sum: { scanCount: true } }),
    prisma.lead.count({ where: leadWhere }),
  ]);
  const totals: Record<string, number> = {};
  grouped.forEach((g) => (totals[g.type] = g._count._all));

  const cardLoc = new Map(cards.map((c) => [c.id, c.locationId]));
  const cardNm = new Map(cards.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]));
  const cardDept = new Map(cards.map((c) => [c.id, c.departmentId]));
  const deptNm = new Map(departments.map((d) => [d.id, d.name]));
  const assetLoc = new Map(assets.map((a) => [a.id, a.locationId]));
  const assetTy = new Map(assets.map((a) => [a.id, a.type]));

  const per = new Map<string, { views: number; leads: number }>();
  locations.forEach((l) => per.set(l.id, { views: 0, leads: 0 }));
  viewsByCard.forEach((v) => {
    const loc = v.cardId ? cardLoc.get(v.cardId) : null;
    if (loc && per.has(loc)) per.get(loc)!.views += v._count._all;
  });
  const statusCounts: Record<string, number> = {};
  const campaignCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  const employeeCounts: Record<string, number> = {};
  const deptCounts: Record<string, number> = {};
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] || 0) + 1);
  leadsInRange.forEach((l) => {
    const loc = (l.cardId && cardLoc.get(l.cardId)) || (l.assetId && assetLoc.get(l.assetId));
    if (loc && per.has(loc)) per.get(loc)!.leads++;
    bump(statusCounts, l.status || "new");
    const camp = l.campaign || l.utmCampaign;
    if (camp) bump(campaignCounts, camp);
    if (l.cardId) bump(sourceCounts, "Employee card");
    else if (l.assetId) bump(sourceCounts, assetTypeLabel(assetTy.get(l.assetId) || "campaign"));
    if (l.cardId && cardNm.get(l.cardId)) bump(employeeCounts, cardNm.get(l.cardId)!);
    const dId = l.cardId ? cardDept.get(l.cardId) : null;
    bump(deptCounts, (dId && deptNm.get(dId)) || "No department");
  });

  return {
    range,
    totals,
    leadCount,
    conversion: conversionPct(leadCount, totals.view || 0),
    assetScans: scanAgg._sum.scanCount || 0,
    leaderboard: sortLeaderboard(locations.map((l) => ({ id: l.id, name: l.name, views: per.get(l.id)!.views, leads: per.get(l.id)!.leads }))),
    funnel: buildFunnel(statusCounts),
    sources: topGroups(sourceCounts, 50),
    campaigns: topGroups(campaignCounts, 50),
    employees: topGroups(employeeCounts, 50),
    deptPerf: topGroups(deptCounts, 50),
  };
}

// Build a multi-section CSV report from computed analytics.
export function analyticsCsv(orgName: string, data: Awaited<ReturnType<typeof computeOrgAnalytics>>): string {
  const rows: (string | number)[][] = [];
  rows.push([`${orgName} — analytics (${data.range.label})`]);
  rows.push([]);
  rows.push(["Metric", "Value"]);
  rows.push(["Card views", data.totals.view || 0]);
  rows.push(["Contacts saved", data.totals.vcard || 0]);
  rows.push(["Link clicks", data.totals.click || 0]);
  rows.push(["QR asset scans (all-time)", data.assetScans]);
  rows.push(["Leads captured", data.leadCount]);
  rows.push(["View to lead rate (%)", data.conversion]);
  rows.push([]);
  rows.push(["Rooftop", "Views", "Leads", "Conversion (%)"]);
  data.leaderboard.forEach((r) => rows.push([r.name, r.views, r.leads, r.conv]));
  rows.push([]);
  rows.push(["Lead status", "Count"]);
  data.funnel.forEach((f) => rows.push([f.label, f.count]));
  rows.push([]);
  rows.push(["Source", "Leads"]);
  data.sources.forEach((s) => rows.push([s.key, s.count]));
  rows.push([]);
  rows.push(["Campaign", "Leads"]);
  data.campaigns.forEach((s) => rows.push([s.key, s.count]));
  rows.push([]);
  rows.push(["Employee", "Leads"]);
  data.employees.forEach((s) => rows.push([s.key, s.count]));
  return toCsv(rows);
}

// Send the weekly manager digest for one org to its configured recipients.
export async function sendDigest(orgId: string): Promise<{ recipients: string[]; delivered: string }> {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true, digestEmails: true } });
  if (!org) return { recipients: [], delivered: "no org" };
  const recipients = parseDigestEmails(org.digestEmails);
  const d = await computeOrgAnalytics(orgId, "7");
  const { subject, text } = buildDigest(org.name, "the last 7 days", {
    views: d.totals.view || 0,
    vcards: d.totals.vcard || 0,
    clicks: d.totals.click || 0,
    assetScans: d.assetScans,
    leads: d.leadCount,
    conversion: d.conversion,
    topRooftops: d.leaderboard.slice(0, 5).map((r) => ({ name: r.name, leads: r.leads })),
    topSources: d.sources.slice(0, 5),
  });
  const res = await sendMail(recipients, subject, text);
  return { recipients, delivered: res.delivered };
}

// Scheduler tick: send digests to every org whose weekly cadence is due.
export async function runDueDigests(now: Date = new Date()): Promise<number> {
  const orgs = await prisma.org.findMany({
    where: { digestCadence: "weekly" },
    select: { id: true, digestCadence: true, digestLastSentAt: true, digestEmails: true },
  });
  let sent = 0;
  for (const o of orgs) {
    if (!digestDue(o.digestCadence, o.digestLastSentAt, now)) continue;
    if (!parseDigestEmails(o.digestEmails).length) continue;
    await sendDigest(o.id).catch(() => {});
    await prisma.org.update({ where: { id: o.id }, data: { digestLastSentAt: now } });
    sent++;
  }
  return sent;
}
