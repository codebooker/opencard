import { Router } from "express";
import { Prisma } from "@prisma/client";
import { runWithOrg } from "../db";
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

// Every handler runs inside runWithOrg(orgId, ...): the queries execute as the
// least-privilege role with `app.current_org_id` set, so Postgres RLS enforces
// tenant isolation at the database. The explicit `orgId`/`findFirst` filters are
// kept as a second, application-level layer of defense.

// ---- brands ----
apiRouter.get("/brands", async (req, res) => {
  const org = apiOrgId(req);
  const brands = await runWithOrg(org, (db) =>
    db.brand.findMany({ where: { orgId: org }, orderBy: { name: "asc" } })
  );
  res.json({ data: brands.map(brandJson) });
});
apiRouter.get("/brands/:id", async (req, res) => {
  const org = apiOrgId(req);
  const b = await runWithOrg(org, (db) => db.brand.findFirst({ where: { id: req.params.id, orgId: org } }));
  if (!b) return res.status(404).json({ error: "not_found" });
  res.json({ data: brandJson(b) });
});
apiRouter.post("/brands", async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(422).json({ error: "name_required" });
  const org = apiOrgId(req);
  const brand = await runWithOrg(org, (db) =>
    db.brand.create({
      data: {
        orgId: org,
        name: String(b.name),
        logoUrl: str(b.logoUrl),
        primaryColor: b.primaryColor || "#1f6f43",
        layout: b.layout || "classic",
      },
    })
  );
  res.status(201).json({ data: brandJson(brand) });
});

// ---- stores (locations) ----
apiRouter.get("/stores", async (req, res) => {
  const org = apiOrgId(req);
  const where: any = { orgId: org };
  if (req.query.brandId) where.brandId = String(req.query.brandId);
  const stores = await runWithOrg(org, (db) => db.location.findMany({ where, orderBy: { name: "asc" } }));
  res.json({ data: stores.map(storeJson) });
});
apiRouter.get("/stores/:id", async (req, res) => {
  const org = apiOrgId(req);
  const l = await runWithOrg(org, (db) => db.location.findFirst({ where: { id: req.params.id, orgId: org } }));
  if (!l) return res.status(404).json({ error: "not_found" });
  res.json({ data: storeJson(l) });
});
apiRouter.post("/stores", async (req, res) => {
  const b = req.body || {};
  if (!b.brandId || !b.name) return res.status(422).json({ error: "brandId_and_name_required" });
  const org = apiOrgId(req);
  const store = await runWithOrg(org, async (db) => {
    // The brand must belong to the caller's org (RLS also blocks cross-tenant rows).
    const brand = await db.brand.findFirst({ where: { id: String(b.brandId), orgId: org } });
    if (!brand) return null;
    return db.location.create({
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
  });
  if (!store) return res.status(422).json({ error: "brand_not_found" });
  res.status(201).json({ data: storeJson(store) });
});

// ---- cards ----
apiRouter.get("/cards", async (req, res) => {
  const org = apiOrgId(req);
  const where: any = { orgId: org };
  if (req.query.locationId) where.locationId = String(req.query.locationId);
  if (req.query.ownerEmail) where.ownerEmail = { equals: String(req.query.ownerEmail), mode: "insensitive" };
  if (req.query.brandId) where.location = { brandId: String(req.query.brandId) };
  const cards = await runWithOrg(org, (db) =>
    db.card.findMany({ where, orderBy: { lastName: "asc" }, take: 500 })
  );
  res.json({ data: cards.map(cardPayload) });
});
apiRouter.get("/cards/:id", async (req, res) => {
  const org = apiOrgId(req);
  const card = await runWithOrg(org, (db) => db.card.findFirst({ where: { id: req.params.id, orgId: org } }));
  if (!card) return res.status(404).json({ error: "not_found" });
  res.json({ data: cardPayload(card) });
});
apiRouter.post("/cards", async (req, res) => {
  const b = req.body || {};
  if (!b.locationId || !b.firstName || !b.lastName) {
    return res.status(422).json({ error: "locationId_firstName_lastName_required" });
  }
  const org = apiOrgId(req);
  const slug = await uniqueSlug(String(b.firstName), String(b.lastName));
  const card = await runWithOrg(org, async (db) => {
    const loc = await db.location.findFirst({ where: { id: String(b.locationId), orgId: org } });
    if (!loc) return null;
    return db.card.create({
      data: { locationId: loc.id, orgId: loc.orgId, slug, ...cardWriteData(b, { create: true }) },
    });
  });
  if (!card) return res.status(422).json({ error: "location_not_found" });
  emitEvent("card.created", cardPayload(card));
  res.status(201).json({ data: cardPayload(card) });
});
apiRouter.patch("/cards/:id", async (req, res) => {
  const org = apiOrgId(req);
  const card = await runWithOrg(org, async (db) => {
    const exists = await db.card.findFirst({ where: { id: req.params.id, orgId: org } });
    if (!exists) return null;
    return db.card.update({ where: { id: req.params.id }, data: cardWriteData(req.body || {}) });
  });
  if (!card) return res.status(404).json({ error: "not_found" });
  emitEvent("card.updated", cardPayload(card));
  res.json({ data: cardPayload(card) });
});
apiRouter.delete("/cards/:id", async (req, res) => {
  const org = apiOrgId(req);
  const card = await runWithOrg(org, async (db) => {
    const found = await db.card.findFirst({ where: { id: req.params.id, orgId: org } });
    if (!found) return null;
    await db.card.delete({ where: { id: req.params.id } });
    return found;
  });
  if (!card) return res.status(404).json({ error: "not_found" });
  emitEvent("card.deleted", { id: card.id, slug: card.slug });
  res.json({ data: { id: card.id, deleted: true } });
});

// ---- leads ----
apiRouter.get("/leads", async (req, res) => {
  const org = apiOrgId(req);
  const where: any = { orgId: org };
  if (req.query.cardId) where.cardId = String(req.query.cardId);
  if (req.query.since) {
    const d = new Date(String(req.query.since));
    if (!isNaN(d.getTime())) where.createdAt = { gte: d };
  }
  const leads = await runWithOrg(org, (db) =>
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { card: { select: { id: true, slug: true, firstName: true, lastName: true } } },
    })
  );
  res.json({ data: leads });
});

// ---- analytics ----
apiRouter.get("/analytics", async (req, res) => {
  const org = apiOrgId(req);
  const where: any = { orgId: org };
  if (req.query.cardId) where.cardId = String(req.query.cardId);
  const grouped = await runWithOrg(org, (db) =>
    db.analyticsEvent.groupBy({ by: ["type"], where, _count: { _all: true } })
  );
  const totals: Record<string, number> = {};
  grouped.forEach((g) => (totals[g.type] = g._count._all));
  res.json({ data: { totals } });
});
