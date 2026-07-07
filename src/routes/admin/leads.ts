// Admin route group: leads (split from admin.ts, CQ-05).
import {
  Router, LEAD_STATUSES, audit, canTransition, clean, prisma, reqAdmin, toCsv,
  accessibleCardIds, leadScopeWhere,
} from "./context";
import { RBAC } from "./context";
import { V } from "./context";

export function registerLeadRoutes(router: Router) {
  const adminRouter = router;

// ---------- leads ----------
// Scope leads to what the admin may see: cards in their locations OR assets in
// their locations (global admins see all).

function leadStatusFilter(req: any): string {
  const s = String(req.query.status || "");
  return (LEAD_STATUSES as readonly string[]).includes(s) ? s : "";
}

adminRouter.get("/leads", async (req, res) => {
  const status = leadStatusFilter(req);
  const scope = await leadScopeWhere(reqAdmin(req));
  const leads = await prisma.lead.findMany({
    where: { ...scope, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: { card: true, asset: true },
    take: 500,
  });
  res.send(V.leadsView(leads, status));
});

// Lead detail + lifecycle history.
adminRouter.get("/leads/:id", async (req, res) => {
  const lead = await prisma.lead.findFirst({
    where: { id: req.params.id, ...(await leadScopeWhere(reqAdmin(req))) },
    include: { card: true, asset: true },
  });
  if (!lead) return res.status(404).send("Lead not found");
  const events = await prisma.leadEvent.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" } });
  res.send(V.leadDetailView({ lead, events }));
});

async function scopedLead(req: any, id: string) {
  return prisma.lead.findFirst({ where: { id, ...(await leadScopeWhere(reqAdmin(req))) } });
}

// Erase a single lead (GDPR/CCPA right to erasure).
adminRouter.post("/leads/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  const lead = await scopedLead(req, req.params.id);
  if (!lead) return res.status(404).send("Lead not found");
  await prisma.leadEvent.deleteMany({ where: { leadId: lead.id } });
  await prisma.lead.delete({ where: { id: lead.id } });
  audit(req, p, "data.delete", { targetType: "Lead", targetId: lead.id, summary: `erased lead: ${lead.name}` });
  res.redirect("/admin/leads");
});

adminRouter.post("/leads/:id/status", async (req, res) => {
  const p = reqAdmin(req);
  const lead = await scopedLead(req, req.params.id);
  if (!lead) return res.status(404).send("Not found");
  const to = clean(req.body?.status) || "";
  if (!canTransition(lead.status, to)) return res.status(400).send("Invalid status transition.");
  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: { status: to } }),
    prisma.leadEvent.create({
      data: { leadId: lead.id, orgId: lead.orgId, type: "status", fromValue: lead.status, toValue: to, actor: p.email || "admin" },
    }),
  ]);
  res.redirect(`/admin/leads/${lead.id}`);
});

adminRouter.post("/leads/:id/assign", async (req, res) => {
  const p = reqAdmin(req);
  const lead = await scopedLead(req, req.params.id);
  if (!lead) return res.status(404).send("Not found");
  const to = clean(req.body?.assignedTo);
  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: { assignedTo: to } }),
    prisma.leadEvent.create({
      data: { leadId: lead.id, orgId: lead.orgId, type: "assign", fromValue: lead.assignedTo, toValue: to, actor: p.email || "admin" },
    }),
  ]);
  res.redirect(`/admin/leads/${lead.id}`);
});

adminRouter.post("/leads/:id/note", async (req, res) => {
  const p = reqAdmin(req);
  const lead = await scopedLead(req, req.params.id);
  if (!lead) return res.status(404).send("Not found");
  const note = clean(req.body?.note);
  if (note) {
    await prisma.leadEvent.create({
      data: { leadId: lead.id, orgId: lead.orgId, type: "note", note, actor: p.email || "admin" },
    });
  }
  res.redirect(`/admin/leads/${lead.id}`);
});

adminRouter.get("/leads.csv", async (req, res) => {
  const status = leadStatusFilter(req);
  const scope = await leadScopeWhere(reqAdmin(req));
  const leads = await prisma.lead.findMany({
    where: { ...scope, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: { card: true, asset: true },
  });
  const rows = [
    [
      "created", "name", "email", "phone", "company", "note",
      "preferred_contact", "vehicle_interest", "trade_in", "service_need", "appointment", "consent",
      "status", "assigned_to", "duplicate_of", "campaign", "utm_source", "utm_medium", "utm_campaign", "referrer", "device",
      "from_card", "department",
    ],
    ...leads.map((l) => [
      new Date(l.createdAt).toISOString(),
      l.name,
      l.email || "",
      l.phone || "",
      l.company || "",
      (l.note || "").replace(/\n/g, " "),
      l.preferredContact || "",
      l.vehicleInterest || "",
      l.tradeIn ? "yes" : "",
      l.serviceNeed || "",
      l.appointmentRequest ? "yes" : "",
      l.consent ? "yes" : "",
      l.status || "new",
      l.assignedTo || "",
      l.duplicateOfId || "",
      l.campaign || "",
      l.utmSource || "",
      l.utmMedium || "",
      l.utmCampaign || "",
      l.referrer || "",
      l.device || "",
      l.card ? `${l.card.firstName} ${l.card.lastName}` : l.asset ? `${l.asset.name} (asset)` : "",
      l.card?.department || "",
    ]),
  ];
  const csv = toCsv(rows);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
  res.send(csv);
});

}
