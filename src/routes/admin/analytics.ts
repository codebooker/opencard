// Admin route group: analytics (split from admin.ts, CQ-05).
import {
  Router, ANALYTICS_RANGES, analyticsCsv, assetTypeLabel, audit, bucketDays, buildFunnel, buildOrgExport,
  clean, computeOrgAnalytics, config, conversionPct, currentTerminology, exportFilename, forbidden,
  parseRetentionDays, prisma, pruneOrgLeads, reqAdmin, resolveRange, sendDigest, sortLeaderboard,
  topGroups, uniqueAssetSlug,
  accessibleCardIds, leadScopeWhere,
} from "./context";
import { RBAC } from "./context";
import { V } from "./context";

export function registerAnalyticsRoutes(router: Router) {
  const adminRouter = router;

// ---------- analytics ----------
adminRouter.get("/cards/:id/analytics", async (req, res) => {
  const target = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), target.locationId))) return forbidden(res);
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ["type"],
    where: { cardId: req.params.id },
    _count: { _all: true },
  });
  const totals: Record<string, number> = {};
  grouped.forEach((g) => (totals[g.type] = g._count._all));
  res.send(
    V.analyticsView({
      totals,
      topCards: [{ name: `${target.firstName} ${target.lastName}`, slug: target.slug, views: totals.view || 0 }],
    })
  );
});

adminRouter.get("/analytics", async (req, res) => {
  const p = reqAdmin(req);
  const range = resolveRange(req.query.range);
  const cardIds = await accessibleCardIds(p); // null = all orgs (platform console)
  const cardFilter = cardIds ? { cardId: { in: cardIds } } : {};
  const dateFilter = range.since ? { createdAt: { gte: range.since } } : {};
  const whereEvents = { ...cardFilter, ...dateFilter };

  // Event totals by type (views, vcard saves, clicks, connects) in range.
  const grouped = await prisma.analyticsEvent.groupBy({ by: ["type"], where: whereEvents, _count: { _all: true } });
  const totals: Record<string, number> = {};
  grouped.forEach((g) => (totals[g.type] = g._count._all));

  // Leads captured (cards + assets) in scope + range.
  const leadScope = await leadScopeWhere(p);
  const leadWhere = { ...leadScope, ...(range.since ? { createdAt: { gte: range.since } } : {}) };
  const leadCount = await prisma.lead.count({ where: leadWhere });

  // Rooftop leaderboard + breakdowns from a single lead fetch + entity maps.
  const locIds = await RBAC.accessibleLocationIds(p);
  const [locations, cards, assets, departments, viewsByCard, leadsInRange, scanAgg] = await Promise.all([
    prisma.location.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true } }),
    prisma.card.findMany({
      where: { locationId: { in: locIds } },
      select: { id: true, locationId: true, departmentId: true, firstName: true, lastName: true },
    }),
    prisma.asset.findMany({ where: { locationId: { in: locIds } }, select: { id: true, locationId: true, type: true } }),
    prisma.department.findMany({ where: { orgId: p.orgId }, select: { id: true, name: true } }),
    prisma.analyticsEvent.groupBy({ by: ["cardId"], where: { type: "view", ...whereEvents }, _count: { _all: true } }),
    prisma.lead.findMany({
      where: leadWhere,
      select: { cardId: true, assetId: true, status: true, campaign: true, utmCampaign: true, utmSource: true },
    }),
    prisma.asset.aggregate({ where: { locationId: { in: locIds } }, _sum: { scanCount: true } }),
  ]);
  const cardLoc = new Map(cards.map((c) => [c.id, c.locationId]));
  const cardName = new Map(cards.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]));
  const cardDept = new Map(cards.map((c) => [c.id, c.departmentId]));
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const assetLoc = new Map(assets.map((a) => [a.id, a.locationId]));
  const assetType = new Map(assets.map((a) => [a.id, a.type]));

  const per = new Map<string, { views: number; leads: number }>();
  locations.forEach((l) => per.set(l.id, { views: 0, leads: 0 }));
  viewsByCard.forEach((v) => {
    const loc = v.cardId ? cardLoc.get(v.cardId) : null;
    if (loc && per.has(loc)) per.get(loc)!.views += v._count._all;
  });
  // Breakdown counters.
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
    // Source channel: employee card vs the asset's type.
    if (l.cardId) bump(sourceCounts, "Employee card");
    else if (l.assetId) bump(sourceCounts, assetTypeLabel(assetType.get(l.assetId) || "campaign"));
    // Employee (card owner).
    if (l.cardId && cardName.get(l.cardId)) bump(employeeCounts, cardName.get(l.cardId)!);
    // Department.
    const dId = l.cardId ? cardDept.get(l.cardId) : null;
    bump(deptCounts, (dId && deptName.get(dId)) || "No department");
  });
  const leaderboard = sortLeaderboard(
    locations.map((l) => ({ id: l.id, name: l.name, views: per.get(l.id)!.views, leads: per.get(l.id)!.leads }))
  );
  const funnel = buildFunnel(statusCounts);
  const sources = topGroups(sourceCounts, 20);
  const campaigns = topGroups(campaignCounts, 10);
  const employees = topGroups(employeeCounts, 10);
  const deptPerf = topGroups(deptCounts, 20);

  // Daily view series for the chart (raw timestamps bucketed in JS; capped so
  // an all-time range on a busy org doesn't pull unbounded rows).
  const viewDates = await prisma.analyticsEvent.findMany({
    where: { type: "view", ...whereEvents },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50000,
  });
  const viewSeries = bucketDays(viewDates.map((v) => v.createdAt), range.since);

  // Top cards by views (in range).
  const topViews = await prisma.analyticsEvent.groupBy({
    by: ["cardId"],
    where: { type: "view", cardId: { not: null }, ...whereEvents },
    _count: { _all: true },
    orderBy: { _count: { cardId: "desc" } },
    take: 10,
  });
  const topCardRows = await prisma.card.findMany({
    where: { id: { in: topViews.map((v) => v.cardId).filter((id): id is string => !!id) } },
  });
  const byId = new Map(topCardRows.map((c) => [c.id, c]));
  const topCards = topViews.map((v) => {
    const c = v.cardId ? byId.get(v.cardId) : undefined;
    return { name: c ? `${c.firstName} ${c.lastName}` : "—", slug: c?.slug || "", views: v._count._all };
  });

  // Top scan/view locations from IP geolocation (cards, asset scans, campaign
  // clicks — anything in scope carrying a geo point in range).
  const geoScope = cardIds
    ? {
        OR: [
          { cardId: { in: cardIds } },
          { asset: { locationId: { in: locIds } } },
          { campaignRef: { orgId: p.orgId } },
        ],
      }
    : {};
  const geoRows = await prisma.analyticsEvent.groupBy({
    by: ["geoCity", "geoRegion", "geoCountry"],
    where: { geoCountry: { not: null }, ...geoScope, ...dateFilter },
    _count: { _all: true },
    orderBy: { _count: { geoCountry: "desc" } },
    take: 12,
  });
  const geoCounts: Record<string, number> = {};
  geoRows.forEach((g) => {
    const label = [g.geoCity, g.geoRegion, g.geoCountry].filter(Boolean).join(", ");
    if (label) geoCounts[label] = (geoCounts[label] || 0) + g._count._all;
  });
  const topLocations = topGroups(geoCounts, 12);

  // Reporting controls (CSV export + manager digest) — org-level, so gate to global admins.
  const orgSettings = p.global
    ? await prisma.org.findUnique({ where: { id: p.orgId }, select: { digestEmails: true, digestCadence: true } })
    : null;
  const reports = p.global
    ? {
        csvUrl: `/admin/analytics/export.csv?range=${range.key}`,
        emails: orgSettings?.digestEmails || "",
        cadence: orgSettings?.digestCadence || "off",
        sent: req.query.digest === "sent",
      }
    : undefined;

  res.send(
    V.analyticsView({
      locationLabel: (await currentTerminology(p.orgId)).locationSingular,
      totals,
      leadCount,
      conversion: conversionPct(leadCount, totals["view"] || 0),
      assetScans: scanAgg._sum.scanCount || 0,
      leaderboard,
      topCards,
      viewSeries,
      funnel,
      sources,
      campaigns,
      employees,
      deptPerf,
      topLocations,
      range: { key: range.key, label: range.label },
      ranges: ANALYTICS_RANGES,
      reports,
    })
  );
});

// CSV export of the org-wide analytics report.
adminRouter.get("/analytics/export.csv", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const rangeKey = String(req.query.range || "30");
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { name: true } });
  const data = await computeOrgAnalytics(p.orgId, rangeKey);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="opencard-analytics-${data.range.key}.csv"`);
  res.send(analyticsCsv(org?.name || "OpenCard", data));
});

// Save the manager-digest recipients + cadence.
adminRouter.post("/reports/digest", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const cadence = req.body?.cadence === "weekly" ? "weekly" : "off";
  await prisma.org.update({
    where: { id: p.orgId },
    data: { digestEmails: clean(req.body?.digestEmails) || null, digestCadence: cadence },
  });
  res.redirect("/admin/analytics");
});

// Send a digest right now (test / on-demand).
adminRouter.post("/reports/digest/test", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  await sendDigest(p.orgId);
  res.redirect("/admin/analytics?digest=sent");
});

// ---------- audit log (Phase 9.1) ----------
adminRouter.get("/audit", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.super) return forbidden(res);
  const action = typeof req.query.action === "string" && req.query.action ? String(req.query.action) : null;
  const where = { ...(RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId }), ...(action ? { action } : {}) };
  const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 250 });
  res.send(V.auditView(logs, action));
});

// ---------- data & privacy (GDPR/CCPA) (Phase 9.2) ----------
adminRouter.get("/data", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { leadRetentionDays: true } });
  res.send(
    V.dataPrivacyView({
      retentionDays: org?.leadRetentionDays ?? null,
      pruned: typeof req.query.pruned === "string" ? Number(req.query.pruned) : null,
    })
  );
});

// Set the lead retention policy.
adminRouter.post("/data/retention", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const days = parseRetentionDays(req.body?.leadRetentionDays);
  await prisma.org.update({ where: { id: p.orgId }, data: { leadRetentionDays: days } });
  audit(req, p, "data.retention", { targetType: "Org", targetId: p.orgId, summary: days ? `${days} days` : "keep forever" });
  res.redirect("/admin/data");
});

// Run the retention prune for this org now (on-demand).
adminRouter.post("/data/retention/prune", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { leadRetentionDays: true } });
  const n = await pruneOrgLeads(p.orgId, org?.leadRetentionDays ?? null);
  res.redirect("/admin/data?pruned=" + n);
});

// ---------- events (Phase 10.2) ----------
function parseDateLocal(v: any): Date | null {
  const s = clean(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

adminRouter.get("/events", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const scope = RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId };
  const [events, locations] = await Promise.all([
    prisma.event.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      include: { location: { select: { name: true } }, _count: { select: { assets: true } } },
    }),
    prisma.location.findMany({ where: scope, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  res.send(V.eventsView({ events, locations }, await currentTerminology(reqAdmin(req).orgId)));
});

adminRouter.post("/events", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const b = req.body || {};
  const name = clean(b.name);
  if (!name) return res.redirect("/admin/events");
  let locationId: string | null = null;
  if (b.locationId) {
    const loc = await prisma.location.findFirst({ where: { id: String(b.locationId), orgId: p.orgId } });
    locationId = loc?.id || null;
  }
  const ev = await prisma.event.create({
    data: { orgId: p.orgId, name, locationId, startsAt: parseDateLocal(b.startsAt), endsAt: parseDateLocal(b.endsAt), active: true },
  });
  res.redirect("/admin/events/" + ev.id);
});

adminRouter.get("/events/:id", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const where = RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId };
  const ev = await prisma.event.findFirst({ where, include: { location: true, assets: { orderBy: { createdAt: "asc" } } } });
  if (!ev) return res.status(404).send("Event not found");
  const assetIds = ev.assets.map((a) => a.id);
  const scans = ev.assets.reduce((s, a) => s + a.scanCount, 0);
  const leads = assetIds.length ? await prisma.lead.count({ where: { assetId: { in: assetIds } } }) : 0;
  const locations = await prisma.location.findMany({
    where: RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  res.send(V.eventDetailView({ ev, scans, leads, baseUrl: config.cardUrl, locations }, await currentTerminology(reqAdmin(req).orgId)));
});

adminRouter.post("/events/:id", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const where = RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId };
  const ev = await prisma.event.findFirst({ where });
  if (!ev) return res.status(404).send("Not found");
  const b = req.body || {};
  await prisma.event.update({
    where: { id: ev.id },
    data: { name: clean(b.name) || ev.name, startsAt: parseDateLocal(b.startsAt), endsAt: parseDateLocal(b.endsAt), active: !!b.active },
  });
  res.redirect("/admin/events/" + ev.id);
});

adminRouter.post("/events/:id/assets", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const where = RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId };
  const ev = await prisma.event.findFirst({ where });
  if (!ev) return res.status(404).send("Not found");
  const b = req.body || {};
  const name = clean(b.name) || "Event QR";
  let locationId = ev.locationId;
  if (!locationId && b.locationId) {
    const loc = await prisma.location.findFirst({ where: { id: String(b.locationId), orgId: p.orgId } });
    locationId = loc?.id || null;
  }
  if (!locationId) return res.status(400).send("Set an event rooftop first (edit the event), then add QR codes.");
  const slug = await uniqueAssetSlug(name);
  await prisma.asset.create({
    data: { orgId: p.orgId, locationId, type: "event", name, slug, destinationType: "landing", eventId: ev.id, active: true },
  });
  res.redirect("/admin/events/" + ev.id);
});

adminRouter.post("/events/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  await prisma.event.deleteMany({ where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId } });
  res.redirect("/admin/events");
});

adminRouter.get("/data/export.json", async (req, res) => {
  const p = reqAdmin(req);
  if (!p.global) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { name: true } });
  const bundle = await buildOrgExport(p.orgId);
  audit(req, p, "data.export", { targetType: "Org", targetId: p.orgId });
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${exportFilename(org?.name)}"`);
  res.send(JSON.stringify(bundle, null, 2));
});

}
