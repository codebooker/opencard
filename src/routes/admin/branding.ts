// Admin route group: branding (split from admin.ts, CQ-05).
import {
  Router, CNAME_TARGET, Prisma, SERVER_IPS, asArray, assetTypeLabel, audit, campaignBanner,
  canAdd, clean, config, currentTerminology, evaluateDomain, forbidden, limitReached, normalizeHost,
  orgIdForBrand, page, parseAddress, parseCampaignRoutingLines, parseCtaLines, parseOemBrands, parseQrDesign, path,
  presetByKey, prisma, qrDesignFromForm, qrSvg, reqAdmin, resolveDomainDns, setTenantDomain, signatureConfig,
  uniqueAssetSlug, upload, uploadedUrl,
} from "./context";
import { RBAC } from "./context";
import { V } from "./context";

export function registerBrandingRoutes(router: Router) {
  const adminRouter = router;

// ---------- brands ----------
adminRouter.get("/brands/new", async (req, res) => {
  if (!RBAC.canCreateBrand(reqAdmin(req))) return forbidden(res);
  const orgNew = await prisma.org.findUnique({ where: { id: reqAdmin(req).orgId }, select: { idCardsEnabled: true } });
  res.send(V.brandForm(undefined, undefined, await currentTerminology(reqAdmin(req).orgId), !!orgNew?.idCardsEnabled));
});
adminRouter.get("/brands/:id/edit", async (req, res) => {
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),req.params.id)) return forbidden(res);
  const t = await currentTerminology(reqAdmin(req).orgId);
  const brand = await prisma.brand.findUnique({
    where: { id: req.params.id },
    include: { locations: { include: { _count: { select: { cards: true } } } }, domains: true },
  });
  if (!brand) return res.status(404).send("Not found");
  const stats = {
    locations: brand.locations.length,
    cards: brand.locations.reduce((sum, l) => sum + l._count.cards, 0),
  };
  const brandOrg = await prisma.org.findUnique({ where: { id: brand.orgId }, select: { idCardsEnabled: true } });
  res.send(V.brandForm(brand, stats, t, !!brandOrg?.idCardsEnabled));
});
// Live preview for the QR designer (admin-authed; params validated by
// parseQrDesign, hostile values fall back to safe defaults).
adminRouter.get("/qr-preview", async (req, res) => {
  const design = parseQrDesign({
    style: String(req.query.style || "square"),
    fill: String(req.query.fill || "#111827"),
    fill2: req.query.fill2 ? String(req.query.fill2) : null,
    bg: String(req.query.bg || "#ffffff"),
    logoUrl: req.query.logo ? String(req.query.logo) : null,
  });
  // Encode a REAL destination so test-scanning the preview works: the entity's
  // own public path when provided, else the marketing site.
  const rawPath = String(req.query.path || "");
  const target = /^\/(c|a|k)\/[a-z0-9-]{1,80}$/.test(rawPath) ? `${config.cardUrl}${rawPath}` : config.baseUrl;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-store");
  res.send(qrSvg(target, design, { size: 360 }));
});

adminRouter.post("/brands", upload.single("logoFile"), async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canCreateBrand(p)) return forbidden(res);
  if (!(await canAdd(p.orgId, "brands"))) return limitReached(res, "brand");
  const b = req.body;
  const newLogoUrl = uploadedUrl(req, "logoFile") || clean(b.logoUrl);
  await prisma.brand.create({
    data: {
      orgId: p.orgId,
      name: b.name,
      logoUrl: newLogoUrl,
      idCardBack: b.idCardBack === "triangles" ? "triangles" : "cubes",
      primaryColor: b.primaryColor || "#1f6f43",
      textColor: b.textColor || "#111827",
      bgColor: b.bgColor || "#ffffff",
      font: b.font || "system",
      layout: b.layout || "classic",
      showQr: !!b.showQr,
      qrDesign: qrDesignFromForm(b, newLogoUrl),
      selfEditFields: asArray(b.selfEditFields),
      leadFields: b.leadDefault ? Prisma.DbNull : asArray(b.leadFields),
      leadConsentText: b.leadDefault ? null : clean(b.leadConsentText),
      ...campaignBanner(b),
    },
  });
  res.redirect("/admin");
});
adminRouter.post("/brands/:id", upload.single("logoFile"), async (req, res) => {
  const p = reqAdmin(req);
  if (!await RBAC.canManageBrandScoped(p, req.params.id)) return forbidden(res);
  const b = req.body;
  const newLogoUrl = uploadedUrl(req, "logoFile") || clean(b.logoUrl);
  const brand = await prisma.brand.update({
    where: { id: req.params.id },
    data: {
      name: b.name,
      logoUrl: newLogoUrl,
      idCardBack: b.idCardBack === "triangles" ? "triangles" : "cubes",
      primaryColor: b.primaryColor,
      textColor: b.textColor,
      bgColor: b.bgColor,
      font: b.font || "system",
      layout: b.layout,
      showQr: !!b.showQr,
      qrDesign: qrDesignFromForm(b, newLogoUrl),
      selfEditFields: asArray(b.selfEditFields),
      leadFields: b.leadDefault ? Prisma.DbNull : asArray(b.leadFields),
      leadConsentText: b.leadDefault ? null : clean(b.leadConsentText),
      ...campaignBanner(b),
    },
  });
  await setTenantDomain(brand.orgId, { brandId: brand.id }, "admin", b.adminDomain);
  await setTenantDomain(brand.orgId, { brandId: brand.id }, "user", b.userDomain);
  res.redirect("/admin");
});

// Delete a brand and everything under it. Guarded: the typed name must match
// exactly (also enforced client-side with two extra confirmations).
adminRouter.post("/brands/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  // Role gate (super) AND tenant scope: an org owner must not be able to delete
  // another tenant's brand even with its id + name. Platform staff on the
  // console (seesAllOrgs) may act cross-org; everyone else is confined to their
  // org, and canManageBrandScoped verifies the brand belongs to their scope.
  if (!RBAC.canDeleteBrand(p)) return forbidden(res);
  if (!(await RBAC.canManageBrandScoped(p, req.params.id))) return forbidden(res);
  const brand = await prisma.brand.findFirst({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
    include: { locations: true },
  });
  if (!brand) return res.status(404).send("Not found");

  if ((req.body?.confirmName || "") !== brand.name) {
    return res
      .status(400)
      .send(
        `The name you typed did not match "${brand.name}". The brand was NOT deleted. ` +
          `<a href="/admin/brands/${brand.id}/edit">Go back</a>.`
      );
  }

  const locationIds = brand.locations.map((l) => l.id);
  // Order matters for FK constraints: cards (cascades events/leads) -> users ->
  // templates -> locations -> brand.
  await prisma.$transaction([
    prisma.card.deleteMany({ where: { locationId: { in: locationIds } } }),
    prisma.user.deleteMany({ where: { locationId: { in: locationIds } } }),
    prisma.template.deleteMany({ where: { brandId: brand.id } }),
    prisma.location.deleteMany({ where: { brandId: brand.id } }),
    prisma.brand.delete({ where: { id: brand.id } }),
  ]);
  audit(req, reqAdmin(req), "brand.delete", { targetType: "Brand", targetId: brand.id, summary: brand.name });
  res.redirect("/admin");
});

// ---------- templates ----------
adminRouter.get("/templates", async (req, res) => {
  const p = reqAdmin(req);
  const brandId = String(req.query.brandId || "");
  if (!await RBAC.canManageBrandScoped(p, brandId)) return forbidden(res);
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) return res.status(404).send("Brand not found");
  const templates = await prisma.template.findMany({ where: { brandId }, orderBy: { createdAt: "asc" } });
  // Cross-brand copy targets: other brands in the same org the admin may manage.
  const otherBrands = p.global
    ? await prisma.brand.findMany({
        where: { orgId: brand.orgId, id: { not: brandId } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];
  res.send(V.templatesGallery(brand.name, brandId, templates, otherBrands));
});
adminRouter.get("/templates/new", async (req, res) => {
  const brandId = String(req.query.brandId || "");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),brandId)) return forbidden(res);
  const preset = presetByKey(String(req.query.preset || ""));
  res.send(V.templateForm(brandId, undefined, await currentTerminology(reqAdmin(req).orgId), preset));
});

// Clone a template within its brand ("<name> copy", never default).
adminRouter.post("/templates/:id/duplicate", async (req, res) => {
  const p = reqAdmin(req);
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(p, tpl.brandId)) return forbidden(res);
  const { id: _id, createdAt: _c, ...data } = tpl as any;
  await prisma.template.create({ data: { ...data, name: `${tpl.name} copy`, isDefault: false } });
  audit(req, p, "template.duplicate", { targetType: "Template", targetId: tpl.id, summary: tpl.name });
  res.redirect(`/admin/templates?brandId=${tpl.brandId}`);
});

// Copy a template to another brand in the SAME org (design + role behaviors).
adminRouter.post("/templates/:id/copy", async (req, res) => {
  const p = reqAdmin(req);
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(p, tpl.brandId)) return forbidden(res);
  const destId = clean(req.body?.brandId) || "";
  const dest = await prisma.brand.findFirst({ where: { id: destId, orgId: tpl.orgId } });
  if (!dest) return res.status(400).send("Destination brand not found in this workspace.");
  if (!await RBAC.canManageBrandScoped(p, dest.id)) return forbidden(res);
  const { id: _id, createdAt: _c, ...data } = tpl as any;
  await prisma.template.create({ data: { ...data, brandId: dest.id, isDefault: false } });
  audit(req, p, "template.copy", { targetType: "Template", targetId: tpl.id, summary: `${tpl.name} -> ${dest.name}` });
  res.redirect(`/admin/templates?brandId=${dest.id}`);
});
adminRouter.get("/templates/:id/edit", async (req, res) => {
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),tpl.brandId)) return forbidden(res);
  res.send(V.templateForm(tpl.brandId, tpl, await currentTerminology(reqAdmin(req).orgId)));
});

function templateData(b: any) {
  return {
    name: b.name,
    layout: b.layout || "classic",
    primaryColor: b.primaryColor || "#1f6f43",
    textColor: b.textColor || "#111827",
    bgColor: b.bgColor || "#ffffff",
    font: b.font || "system",
    isDefault: !!b.isDefault,
    // role-template behaviors
    role: clean(b.role),
    lockedFields: asArray(b.lockedFields),
    hiddenFields: asArray(b.hiddenFields),
    roleCtas: parseCtaLines(b.roleCtas),
    leadCapture: !!b.leadCapture,
    disclaimer: clean(b.disclaimer),
    showQr: b.showQr === "1" ? true : b.showQr === "0" ? false : null,
    emailSignature: clean(b.emailSignature),
    leadFields: b.leadInherit ? Prisma.DbNull : asArray(b.leadFields),
    leadConsentText: b.leadInherit ? null : clean(b.leadConsentText),
  };
}

adminRouter.post("/templates", async (req, res) => {
  const b = req.body;
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),b.brandId)) return forbidden(res);
  if (b.isDefault) await prisma.template.updateMany({ where: { brandId: b.brandId }, data: { isDefault: false } });
  await prisma.template.create({ data: { brandId: b.brandId, orgId: await orgIdForBrand(b.brandId), ...templateData(b) } });
  res.redirect(`/admin/templates?brandId=${b.brandId}`);
});
adminRouter.post("/templates/:id", async (req, res) => {
  const b = req.body;
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),tpl.brandId)) return forbidden(res);
  if (b.isDefault) await prisma.template.updateMany({ where: { brandId: tpl.brandId }, data: { isDefault: false } });
  await prisma.template.update({ where: { id: req.params.id }, data: templateData(b) });
  res.redirect(`/admin/templates?brandId=${tpl.brandId}`);
});
adminRouter.post("/templates/:id/delete", async (req, res) => {
  const tpl = await prisma.template.findUnique({ where: { id: req.params.id } });
  if (!tpl) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),tpl.brandId)) return forbidden(res);
  await prisma.$transaction([
    prisma.card.updateMany({ where: { templateId: tpl.id }, data: { templateId: null } }),
    prisma.template.delete({ where: { id: tpl.id } }),
  ]);
  res.redirect(`/admin/templates?brandId=${tpl.brandId}`);
});

// ---------- locations (stores) ----------
// Dealership rooftop profile fields parsed from the location editor form.
function rooftopProfile(b: any) {
  return {
    // Checkboxes are "show X"; absent = hide. The location form always renders them.
    hideCardFooter: b.showFooter !== "1",
    hideDealerHeader: b.showDealerHeader !== "1",
    oemBrands: parseOemBrands(b.oemBrands),
    phone: clean(b.phone),
    website: clean(b.website),
    salesUrl: clean(b.salesUrl),
    serviceUrl: clean(b.serviceUrl),
    timezone: clean(b.timezone),
    leadEmail: clean(b.leadEmail),
    campaignRouting: parseCampaignRoutingLines(b.campaignRouting),
  };
}

adminRouter.get("/locations/new", async (req, res) => {
  const brandId = String(req.query.brandId || "");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),brandId)) return forbidden(res);
  res.send(V.locationForm(brandId, undefined, await currentTerminology(reqAdmin(req).orgId)));
});
adminRouter.get("/locations/:id/edit", async (req, res) => {
  const loc = await prisma.location.findUnique({ where: { id: req.params.id }, include: { domains: true } });
  if (!loc) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
  res.send(V.locationForm(loc.brandId, loc, await currentTerminology(reqAdmin(req).orgId)));
});
adminRouter.post("/locations", upload.single("logoFile"), async (req, res) => {
  const p = reqAdmin(req);
  const b = req.body;
  if (!(await RBAC.canManageBrandScoped(p, b.brandId))) return forbidden(res);
  if (!(await canAdd(p.orgId, "locations"))) return limitReached(res, "location");
  await prisma.location.create({
    data: {
      brandId: b.brandId,
      orgId: await orgIdForBrand(b.brandId),
      name: b.name,
      code: clean(b.code),
      logoUrl: uploadedUrl(req, "logoFile") || clean(b.logoUrl),
      primaryColor: clean(b.primaryColor),
      layout: clean(b.layout),
      address: parseAddress(b) || undefined,
      ...rooftopProfile(b),
    },
  });
  res.redirect("/admin");
});
adminRouter.post("/locations/:id", upload.single("logoFile"), async (req, res) => {
  const b = req.body;
  const loc = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!loc) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
  await prisma.location.update({
    where: { id: req.params.id },
    data: {
      name: b.name,
      code: clean(b.code),
      logoUrl: uploadedUrl(req, "logoFile") || clean(b.logoUrl),
      primaryColor: clean(b.primaryColor),
      layout: clean(b.layout),
      address: parseAddress(b) || undefined,
      ...rooftopProfile(b),
      ...signatureConfig(b),
    },
  });
  await setTenantDomain(loc.orgId, { locationId: loc.id }, "admin", b.adminDomain);
  await setTenantDomain(loc.orgId, { locationId: loc.id }, "user", b.userDomain);
  res.redirect("/admin");
});

// ---------- custom domains hub (self-serve branded-login onboarding) ----------
// Resolve the brand a domain belongs to (for permission checks).
function domainBrandId(d: any): string | null {
  return d.brandId || d.location?.brandId || null;
}

adminRouter.get("/domains", async (req, res) => {
  const p = reqAdmin(req);
  const orgWhere = RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId };
  const all = await prisma.tenantDomain.findMany({
    where: orgWhere,
    include: { brand: true, location: { include: { brand: true } } },
    orderBy: { createdAt: "asc" },
  });
  // Non-global admins only see domains for brands/rooftops they can access.
  const accessible = new Set(await RBAC.accessibleBrandIds(p));
  const domains = p.global ? all : all.filter((d) => accessible.has(domainBrandId(d) || ""));
  const brandIds = await RBAC.accessibleBrandIds(p);
  const brands = await prisma.brand.findMany({
    where: { id: { in: brandIds } },
    include: { locations: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
  const flash =
    typeof req.query.checked === "string"
      ? `Checked ${req.query.checked}: ${req.query.msg || ""}`
      : req.query.added
      ? "Domain added. Create the DNS record below, then click Verify."
      : null;
  res.send(V.domainsView({ domains, brands, target: CNAME_TARGET, flash }));
});

adminRouter.post("/domains", async (req, res) => {
  const p = reqAdmin(req);
  const host = normalizeHost(req.body?.host);
  const kind = req.body?.kind === "admin" ? "admin" : "user";
  const [scopeType, scopeId] = String(req.body?.scope || "").split(":");
  if (!host || !scopeId) return res.redirect("/admin/domains");
  let orgId: string, brandForPerm: string, scope: { brandId?: string; locationId?: string };
  if (scopeType === "location") {
    const loc = await prisma.location.findUnique({ where: { id: scopeId } });
    if (!loc) return res.status(404).send("Not found");
    orgId = loc.orgId;
    brandForPerm = loc.brandId;
    scope = { locationId: loc.id };
  } else {
    const brand = await prisma.brand.findUnique({ where: { id: scopeId } });
    if (!brand) return res.status(404).send("Not found");
    orgId = brand.orgId;
    brandForPerm = brand.id;
    scope = { brandId: brand.id };
  }
  if (!(await RBAC.canManageBrandScoped(p, brandForPerm))) return forbidden(res);
  await setTenantDomain(orgId, scope, kind as "admin" | "user", host);
  audit(req, p, "domain.add", { targetType: "TenantDomain", summary: `${host} (${kind})` });
  res.redirect("/admin/domains?added=1");
});

adminRouter.post("/domains/:id/verify", async (req, res) => {
  const p = reqAdmin(req);
  const d = await prisma.tenantDomain.findUnique({
    where: { id: req.params.id },
    include: { location: true },
  });
  if (!d) return res.status(404).send("Not found");
  const brandId = domainBrandId(d);
  if (!brandId || !(await RBAC.canManageBrandScoped(p, brandId))) return forbidden(res);
  const verdict = evaluateDomain(await resolveDomainDns(d.host), { cnameTarget: CNAME_TARGET, ips: SERVER_IPS });
  await prisma.tenantDomain.update({
    where: { id: d.id },
    data: { verifyState: verdict.ok ? "verified" : "pending", verifiedAt: new Date() },
  });
  res.redirect(`/admin/domains?checked=${encodeURIComponent(d.host)}&msg=${encodeURIComponent(verdict.reason)}`);
});

adminRouter.post("/domains/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  const d = await prisma.tenantDomain.findUnique({ where: { id: req.params.id }, include: { location: true } });
  if (!d) return res.redirect("/admin/domains");
  const brandId = domainBrandId(d);
  if (!brandId || !(await RBAC.canManageBrandScoped(p, brandId))) return forbidden(res);
  await prisma.tenantDomain.delete({ where: { id: d.id } });
  audit(req, p, "domain.remove", { targetType: "TenantDomain", targetId: d.id, summary: d.host });
  res.redirect("/admin/domains");
});

// ---------- departments (per rooftop) ----------
async function locationForDept(id: string) {
  return prisma.location.findUnique({ where: { id }, select: { id: true, name: true, brandId: true, orgId: true } });
}

adminRouter.get("/locations/:id/departments", async (req, res) => {
  const loc = await locationForDept(req.params.id);
  if (!loc) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
  const departments = await prisma.department.findMany({
    where: { locationId: loc.id },
    orderBy: { name: "asc" },
  });
  res.send(V.departmentsView({ location: loc, departments }, await currentTerminology(reqAdmin(req).orgId)));
});

adminRouter.post("/locations/:id/departments", async (req, res) => {
  const loc = await locationForDept(req.params.id);
  if (!loc) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
  const ctas = parseCtaLines(req.body?.ctas);
  const leadEmail = clean(req.body?.leadEmail);
  const deptId = clean(req.body?.departmentId);
  if (deptId) {
    // update (name is fixed once created), scoped to this rooftop
    await prisma.department.updateMany({ where: { id: deptId, locationId: loc.id }, data: { ctas, leadEmail } });
  } else {
    const name = clean(req.body?.name);
    if (name) {
      await prisma.department.upsert({
        where: { locationId_name: { locationId: loc.id, name } },
        create: { locationId: loc.id, orgId: loc.orgId, name, ctas, leadEmail },
        update: { ctas, leadEmail },
      });
    }
  }
  res.redirect(`/admin/locations/${loc.id}/departments`);
});

adminRouter.post("/departments/:id/delete", async (req, res) => {
  const dept = await prisma.department.findUnique({
    where: { id: req.params.id },
    include: { location: { select: { id: true, brandId: true } } },
  });
  if (!dept) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),dept.location.brandId)) return forbidden(res);
  await prisma.department.delete({ where: { id: dept.id } });
  res.redirect(`/admin/locations/${dept.location.id}/departments`);
});

// ---------- assets (per rooftop) ----------
function assetDataFromBody(b: any) {
  const validTypes = ["rooftop", "department", "desk", "vehicle", "service_lane", "event", "campaign"];
  const validDest = ["url", "card", "sales", "service", "landing"];
  const type = validTypes.includes(b.type) ? b.type : "campaign";
  const destinationType = validDest.includes(b.destinationType) ? b.destinationType : "landing";
  return {
    type,
    name: clean(b.name) || assetTypeLabel(type),
    destinationType,
    destinationUrl: destinationType === "url" ? clean(b.destinationUrl) : null,
    // destinationCardId validated against the rooftop by the caller
  };
}

// ---------- QR Codes hub (org-wide, top-nav) ----------
// The friendly front door to trackable QR codes: list every asset the admin
// can see and create new ones without digging into a location's Assets page.
adminRouter.get("/qr", async (req, res) => {
  const p = reqAdmin(req);
  // Platform console (not drilled into a client): tenants must not blend into
  // one create form. Show a cross-client overview and point staff at the
  // client drill-in flow for creation.
  const platformConsole = RBAC.seesAllOrgs(p);
  const locIds = await RBAC.accessibleLocationIds(p);
  const [assets, locations, t] = await Promise.all([
    prisma.asset.findMany({
      where: { locationId: { in: locIds } },
      include: { location: { select: { name: true } }, org: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    platformConsole
      ? Promise.resolve([])
      : prisma.location.findMany({
          where: { id: { in: locIds } },
          select: { id: true, name: true, brand: { select: { name: true } } },
          orderBy: { name: "asc" },
        }),
    currentTerminology(p.actingOrgId || p.orgId),
  ]);
  let actingClientName: string | undefined;
  if (p.actingOrgId) {
    const org = await prisma.org.findUnique({ where: { id: p.actingOrgId }, select: { name: true } });
    actingClientName = org?.name;
  }
  res.send(
    V.qrCodesView({
      assets,
      locations: locations.map((l) => ({ id: l.id, name: l.name, brandName: l.brand.name })),
      cardBaseUrl: config.cardUrl,
      created: req.query.created ? String(req.query.created) : null,
      locationLabel: t.locationSingular,
      platformConsole,
      actingClientName,
    })
  );
});

adminRouter.post("/qr", async (req, res) => {
  const p = reqAdmin(req);
  // Creation is per-tenant: platform staff must drill into a client first so a
  // new code can't be filed under the wrong org.
  if (RBAC.seesAllOrgs(p)) return forbidden(res, "Open a client workspace first, then create their QR codes.");
  const locIds = await RBAC.accessibleLocationIds(p);
  const locationId = clean(req.body?.locationId);
  if (!locationId || !locIds.includes(locationId)) return forbidden(res);
  const loc = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true, orgId: true } });
  if (!loc) return res.status(404).send("Not found");
  const name = clean(req.body?.name);
  if (!name) return res.status(400).send("Name required");
  const destinationType = req.body?.destinationType === "landing" ? "landing" : "url";
  const destinationUrl = destinationType === "url" ? clean(req.body?.destinationUrl) : null;
  if (destinationType === "url" && !/^https?:\/\/\S+$/i.test(destinationUrl ? (destinationUrl.startsWith("http") ? destinationUrl : `https://${destinationUrl}`) : "")) {
    return res.status(400).send("A destination URL is required for a redirect QR code.");
  }
  const slug = await uniqueAssetSlug(name);
  await prisma.asset.create({
    data: {
      orgId: loc.orgId,
      locationId: loc.id,
      type: "campaign",
      name,
      slug,
      destinationType,
      destinationUrl: destinationUrl ? (destinationUrl.startsWith("http") ? destinationUrl : `https://${destinationUrl}`) : null,
    },
  });
  res.redirect(`/admin/qr?created=${encodeURIComponent(slug)}`);
});

adminRouter.get("/locations/:id/assets", async (req, res) => {
  const loc = await locationForDept(req.params.id);
  if (!loc) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
  const [assets, cards, brand] = await Promise.all([
    prisma.asset.findMany({ where: { locationId: loc.id }, orderBy: { createdAt: "desc" } }),
    prisma.card.findMany({
      where: { locationId: loc.id, active: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.brand.findUnique({ where: { id: loc.brandId }, select: { logoUrl: true, qrDesign: true } }),
  ]);
  res.send(V.assetsView({ location: loc, assets, cards, cardBaseUrl: config.cardUrl, brand }));
});

adminRouter.post("/locations/:id/assets", async (req, res) => {
  const loc = await locationForDept(req.params.id);
  if (!loc) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),loc.brandId)) return forbidden(res);
  const data = assetDataFromBody(req.body);
  // Resolve + validate the destination card against this rooftop.
  let destinationCardId: string | null = null;
  if (data.destinationType === "card") {
    const cid = clean(req.body?.destinationCardId);
    if (cid) {
      const ok = await prisma.card.count({ where: { id: cid, locationId: loc.id } });
      if (ok) destinationCardId = cid;
    }
  }
  // Per-asset QR design override ("Standard" = inherit brand -> null).
  const assetBrand = await prisma.brand.findUnique({ where: { id: loc.brandId }, select: { logoUrl: true } });
  const qrDesign = qrDesignFromForm(req.body, assetBrand?.logoUrl);
  const assetId = clean(req.body?.assetId);
  if (assetId) {
    await prisma.asset.updateMany({
      where: { id: assetId, locationId: loc.id },
      data: { ...data, destinationCardId, qrDesign },
    });
  } else {
    const slug = await uniqueAssetSlug(data.name);
    await prisma.asset.create({
      data: { ...data, destinationCardId, qrDesign, orgId: loc.orgId, locationId: loc.id, slug },
    });
  }
  res.redirect(`/admin/locations/${loc.id}/assets`);
});

adminRouter.post("/assets/:id/delete", async (req, res) => {
  const asset = await prisma.asset.findUnique({
    where: { id: req.params.id },
    include: { location: { select: { id: true, brandId: true } } },
  });
  if (!asset) return res.status(404).send("Not found");
  if (!await RBAC.canManageBrandScoped(reqAdmin(req),asset.location.brandId)) return forbidden(res);
  await prisma.asset.delete({ where: { id: asset.id } });
  res.redirect(`/admin/locations/${asset.location.id}/assets`);
});

}
