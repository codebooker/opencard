import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requireApi, apiOrgId } from "../apiauth";
import { uniqueSlug } from "../slug";
import { emitEvent, cardPayload } from "../webhooks";

export const apiRouter = Router();
apiRouter.use(requireApi);

apiRouter.get("/", (_req, res) =>
  res.json({
    name: "OpenCard API",
    version: "v1",
    resources: ["/brands", "/stores", "/cards", "/leads", "/analytics"],
  })
);

// ---- helpers ----
const str = (v: any) => (v === null || v === undefined ? null : String(v));

function cardWriteData(b: any, opts: { create?: boolean } = {}) {
  const out: any = {};
  for (const f of ["prefix", "pronouns", "title", "department", "company", "bio", "photoUrl", "layout", "primaryColor", "logoUrl", "ownerEmail"]) {
    if (b[f] !== undefined) out[f] = str(b[f]);
  }
  if (b.firstName !== undefined) out.firstName = String(b.firstName);
  if (b.lastName !== undefined) out.lastName = String(b.lastName);
  for (const f of ["phones", "emails", "websites", "socials"]) {
    if (Array.isArray(b[f])) out[f] = b[f];
  }
  if (b.address !== undefined) out.address = b.address === null ? Prisma.DbNull : b.address;
  if (typeof b.active === "boolean") out.active = b.active;
  if (b.showQr === null || typeof b.showQr === "boolean") out.showQr = b.showQr;
  if (b.templateId !== undefined) out.templateId = str(b.templateId);
  return out;
}

function brandJson(b: any) {
  return {
    id: b.id,
    name: b.name,
    logoUrl: b.logoUrl ?? null,
    primaryColor: b.primaryColor,
    layout: b.layout,
    selfEditFields: b.selfEditFields ?? [],
    createdAt: b.createdAt,
  };
}
function storeJson(l: any) {
  return {
    id: l.id,
    brandId: l.brandId,
    name: l.name,
    code: l.code ?? null,
    logoUrl: l.logoUrl ?? null,
    primaryColor: l.primaryColor ?? null,
    layout: l.layout ?? null,
    address: l.address ?? null,
    createdAt: l.createdAt,
  };
}

// ---- brands ----
apiRouter.get("/brands", async (req, res) => {
  const brands = await prisma.brand.findMany({ where: { orgId: apiOrgId(req) }, orderBy: { name: "asc" } });
  res.json({ data: brands.map(brandJson) });
});
apiRouter.get("/brands/:id", async (req, res) => {
  const b = await prisma.brand.findFirst({ where: { id: req.params.id, orgId: apiOrgId(req) } });
  if (!b) return res.status(404).json({ error: "not_found" });
  res.json({ data: brandJson(b) });
});
apiRouter.post("/brands", async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(422).json({ error: "name_required" });
  const brand = await prisma.brand.create({
    data: {
      orgId: apiOrgId(req),
      name: String(b.name),
      logoUrl: str(b.logoUrl),
      primaryColor: b.primaryColor || "#1f6f43",
      layout: b.layout || "classic",
    },
  });
  res.status(201).json({ data: brandJson(brand) });
});

// ---- stores (locations) ----
apiRouter.get("/stores", async (req, res) => {
  const where: any = { orgId: apiOrgId(req) };
  if (req.query.brandId) where.brandId = String(req.query.brandId);
  const stores = await prisma.location.findMany({ where, orderBy: { name: "asc" } });
  res.json({ data: stores.map(storeJson) });
});
apiRouter.get("/stores/:id", async (req, res) => {
  const l = await prisma.location.findFirst({ where: { id: req.params.id, orgId: apiOrgId(req) } });
  if (!l) return res.status(404).json({ error: "not_found" });
  res.json({ data: storeJson(l) });
});
apiRouter.post("/stores", async (req, res) => {
  const b = req.body || {};
  if (!b.brandId || !b.name) return res.status(422).json({ error: "brandId_and_name_required" });
  // The brand must belong to the caller's org (prevents cross-tenant writes).
  const brand = await prisma.brand.findFirst({ where: { id: String(b.brandId), orgId: apiOrgId(req) } });
  if (!brand) return res.status(422).json({ error: "brand_not_found" });
  const store = await prisma.location.create({
    data: {
      brandId: brand.id,
      orgId: brand.orgId,
      name: String(b.name),
      code: str(b.code),
      logoUrl: str(b.logoUrl),
      primaryColor: str(b.primaryColor),
      layout: str(b.layout),
      address: b.address ?? undefined,
    },
  });
  res.status(201).json({ data: storeJson(store) });
});

// ---- cards ----
apiRouter.get("/cards", async (req, res) => {
  const where: any = { orgId: apiOrgId(req) };
  if (req.query.locationId) where.locationId = String(req.query.locationId);
  if (req.query.ownerEmail) where.ownerEmail = { equals: String(req.query.ownerEmail), mode: "insensitive" };
  if (req.query.brandId) where.location = { brandId: String(req.query.brandId) };
  const cards = await prisma.card.findMany({ where, orderBy: { lastName: "asc" }, take: 500 });
  res.json({ data: cards.map(cardPayload) });
});
apiRouter.get("/cards/:id", async (req, res) => {
  const card = await prisma.card.findFirst({ where: { id: req.params.id, orgId: apiOrgId(req) } });
  if (!card) return res.status(404).json({ error: "not_found" });
  res.json({ data: cardPayload(card) });
});
apiRouter.post("/cards", async (req, res) => {
  const b = req.body || {};
  if (!b.locationId || !b.firstName || !b.lastName) {
    return res.status(422).json({ error: "locationId_firstName_lastName_required" });
  }
  const loc = await prisma.location.findFirst({ where: { id: String(b.locationId), orgId: apiOrgId(req) } });
  if (!loc) return res.status(422).json({ error: "location_not_found" });
  const slug = await uniqueSlug(String(b.firstName), String(b.lastName));
  const card = await prisma.card.create({
    data: { locationId: String(b.locationId), orgId: loc.orgId, slug, ...cardWriteData(b, { create: true }) },
  });
  emitEvent("card.created", cardPayload(card));
  res.status(201).json({ data: cardPayload(card) });
});
apiRouter.patch("/cards/:id", async (req, res) => {
  const exists = await prisma.card.findFirst({ where: { id: req.params.id, orgId: apiOrgId(req) } });
  if (!exists) return res.status(404).json({ error: "not_found" });
  const card = await prisma.card.update({ where: { id: req.params.id }, data: cardWriteData(req.body || {}) });
  emitEvent("card.updated", cardPayload(card));
  res.json({ data: cardPayload(card) });
});
apiRouter.delete("/cards/:id", async (req, res) => {
  const card = await prisma.card.findFirst({ where: { id: req.params.id, orgId: apiOrgId(req) } });
  if (!card) return res.status(404).json({ error: "not_found" });
  await prisma.card.delete({ where: { id: req.params.id } });
  emitEvent("card.deleted", { id: card.id, slug: card.slug });
  res.json({ data: { id: card.id, deleted: true } });
});

// ---- leads ----
apiRouter.get("/leads", async (req, res) => {
  const where: any = { orgId: apiOrgId(req) };
  if (req.query.cardId) where.cardId = String(req.query.cardId);
  if (req.query.since) {
    const d = new Date(String(req.query.since));
    if (!isNaN(d.getTime())) where.createdAt = { gte: d };
  }
  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { card: { select: { id: true, slug: true, firstName: true, lastName: true } } },
  });
  res.json({ data: leads });
});

// ---- analytics ----
apiRouter.get("/analytics", async (req, res) => {
  const where: any = { orgId: apiOrgId(req) };
  if (req.query.cardId) where.cardId = String(req.query.cardId);
  const grouped = await prisma.analyticsEvent.groupBy({ by: ["type"], where, _count: { _all: true } });
  const totals: Record<string, number> = {};
  grouped.forEach((g) => (totals[g.type] = g._count._all));
  res.json({ data: { totals } });
});
