// Admin route group: cards (split from admin.ts, CQ-05).
import {
  Router, Prisma, asArray, buildIdCardPdf, buildSignatureModel, cardPayload, clean,
  config, ctasFromJson, currentTerminology, emitEvent, forbidden, limitReached, mergeCtas, offboardCardUpdate,
  page, parseAddress, parseLabeled, parseSocials, prisma, redirectTargetUrl, renderSignatureHtml, renderSignatureText,
  replacementCardData, reqAdmin, rooftopCtas, signatureBlock, uniqueSlug, upload, uploadedUrl,
  isOrgLimitReached, withOrgLimit,
  accessibleCardIds,
} from "./context";
import { RBAC } from "./context";
import { V } from "./context";

export function registerCardRoutes(router: Router) {
  const adminRouter = router;

// ---------- cards ----------
adminRouter.get("/cards", async (req, res) => {
  const t = await currentTerminology(reqAdmin(req).orgId);
  const locationId = String(req.query.locationId || "");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), locationId))) return forbidden(res);
  const loc = await prisma.location.findUnique({ where: { id: locationId } });
  if (!loc) return res.status(404).send(`${t.locationSingular} not found`);
  const cards = await prisma.card.findMany({
    where: { locationId },
    orderBy: { lastName: "asc" },
  });
  res.send(V.cardList(loc.name, locationId, cards, t, true));
});

function brandFields(brand: { selfEditFields: unknown } | null): string[] | undefined {
  return brand && Array.isArray(brand.selfEditFields) ? (brand.selfEditFields as string[]) : undefined;
}

// Effective design a card inherits with no template — plus the rooftop
// context (CTAs, OEM badges, footer, QR default) so the card editor's live
// preview renders the WHOLE public page, not just the identity block.
function baseDesign(loc: any) {
  const b = loc.brand;
  const oems = Array.isArray(loc.oemBrands) ? loc.oemBrands.join(",") : String(loc.oemBrands || "");
  return {
    layout: loc.layout || b.layout || "classic",
    primary: loc.primaryColor || b.primaryColor || "#1f6f43",
    text: b.textColor || "#111827",
    bg: b.bgColor || "#ffffff",
    font: b.font || "system",
    logo: loc.logoUrl || b.logoUrl || "",
    locName: loc.name || "",
    brandName: b.name || "",
    sales: loc.salesUrl || "",
    service: loc.serviceUrl || "",
    locphone: loc.phone || "",
    locweb: loc.website || "",
    oems,
    footer: loc.hideCardFooter ? "0" : "1",
    dealerheader: loc.hideDealerHeader ? "0" : "1",
    qrDefault: b.showQr ? "1" : "0",
  };
}

adminRouter.get("/cards/new", async (req, res) => {
  const t = await currentTerminology(reqAdmin(req).orgId);
  const locationId = String(req.query.locationId || "");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), locationId))) return forbidden(res);
  const loc = await prisma.location.findUnique({
    where: { id: locationId },
    include: { brand: true },
  });
  if (!loc) return res.status(404).send(`${t.locationSingular} not found`);
  const templates = await prisma.template.findMany({ where: { brandId: loc.brandId } });
  const departments = await prisma.department.findMany({ where: { locationId }, orderBy: { name: "asc" } });
  res.send(
    V.cardForm({
      locationId,
      templates,
      departments,
      brandSelfFields: brandFields(loc.brand),
      terminology: t,
      baseDesign: baseDesign(loc),
      idCards: true,
    })
  );
});

adminRouter.get("/cards/:id/edit", async (req, res) => {
  const t = await currentTerminology(reqAdmin(req).orgId);
  const card = await prisma.card.findUnique({
    where: { id: req.params.id },
    include: { location: { include: { brand: true } } },
  });
  if (!card) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);
  const templates = await prisma.template.findMany({ where: { brandId: card.location.brandId } });
  const departments = await prisma.department.findMany({
    where: { locationId: card.locationId },
    orderBy: { name: "asc" },
  });
  res.send(
    V.cardForm({
      card,
      locationId: card.locationId,
      templates,
      departments,
      brandSelfFields: brandFields(card.location.brand),
      terminology: t,
      baseDesign: baseDesign(card.location),
      idCards: true,
    })
  );
});

async function allowedTemplateId(templateId: string | null, brandId: string): Promise<string | null> {
  if (!templateId) return null;
  const count = await prisma.template.count({ where: { id: templateId, brandId } });
  return count ? templateId : null;
}

function cardDataFromBody(b: any, templateId: string | null) {
  return {
    prefix: clean(b.prefix),
    firstName: b.firstName,
    lastName: b.lastName,
    pronouns: clean(b.pronouns),
    title: clean(b.title),
    department: clean(b.department),
    company: clean(b.company),
    bio: clean(b.bio),
    photoUrl: clean(b.photoUrl),
    phones: parseLabeled(b.phones),
    emails: parseLabeled(b.emails),
    websites: parseLabeled(b.websites),
    socials: parseSocials(b.socials),
    address: parseAddress(b) || undefined,
    templateId,
    layout: clean(b.layout),
    primaryColor: clean(b.primaryColor),
    logoUrl: clean(b.logoUrl),
    ownerEmail: clean(b.ownerEmail),
    showQr: b.showQr === "1" ? true : b.showQr === "0" ? false : null,
    // selfInherit checked => inherit brand policy (store SQL NULL); else store the chosen list.
    selfEditFields: b.selfInherit ? Prisma.DbNull : asArray(b.selfEditFields),
  };
}

const cardUploads = upload.fields([
  { name: "photoFile", maxCount: 1 },
  { name: "logoFile", maxCount: 1 },
]);

// Overlay uploaded files onto the parsed card data (uploads win over URL fields).
function withCardUploads(req: any) {
  const data = cardDataFromBody(req.body, null);
  const photo = uploadedUrl(req, "photoFile");
  const logo = uploadedUrl(req, "logoFile");
  if (photo) data.photoUrl = photo;
  if (logo) data.logoUrl = logo;
  return data;
}

// Resolve the chosen department (validated against the card's rooftop) onto the
// card data: sets departmentId and the display `department` string to its name.
async function applyDepartment(data: any, b: any, locationId: string) {
  const deptId = clean(b.departmentId);
  if (deptId) {
    const d = await prisma.department.findFirst({ where: { id: deptId, locationId } });
    if (d) {
      data.departmentId = d.id;
      data.department = d.name;
      return;
    }
  }
  data.departmentId = null; // keeps any free-text `department` fallback from the form
}

adminRouter.post("/cards", cardUploads, async (req, res) => {
  const p = reqAdmin(req);
  const b = req.body;
  if (!(await RBAC.canAccessLocation(p, b.locationId))) return forbidden(res);
  const loc = await prisma.location.findUnique({ where: { id: b.locationId } });
  if (!loc) return res.status(404).send("Location not found");
  const slug = await uniqueSlug(b.firstName, b.lastName);
  const data = withCardUploads(req);
  data.templateId = await allowedTemplateId(clean(b.templateId), loc.brandId);
  await applyDepartment(data, b, b.locationId);
  let card;
  try {
    card = await withOrgLimit(p.orgId, "cards", () =>
      prisma.card.create({
        data: { locationId: b.locationId, orgId: loc.orgId, slug, ...data },
      })
    );
  } catch (e) {
    if (isOrgLimitReached(e)) return limitReached(res, "card");
    throw e;
  }
  emitEvent(card.orgId, "card.created", cardPayload(card));
  res.redirect(`/admin/cards?locationId=${b.locationId}`);
});

adminRouter.post("/cards/:id", cardUploads, async (req, res) => {
  const b = req.body;
  const existing = await prisma.card.findUnique({
    where: { id: req.params.id },
    include: { location: true },
  });
  if (!existing) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), existing.locationId))) return forbidden(res);
  const data = withCardUploads(req);
  data.templateId = await allowedTemplateId(clean(b.templateId), existing.location.brandId);
  await applyDepartment(data, b, existing.locationId);
  const card = await prisma.card.update({ where: { id: req.params.id }, data });
  emitEvent(card.orgId, "card.updated", cardPayload(card));
  res.redirect(`/admin/cards?locationId=${existing.locationId}`);
});

adminRouter.post("/cards/:id/delete", async (req, res) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id } });
  if (card && !(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);
  await prisma.card.delete({ where: { id: req.params.id } });
  if (card) emitEvent(card.orgId, "card.deleted", { id: card.id, slug: card.slug });
  res.redirect(`/admin/cards?locationId=${card?.locationId || ""}`);
});

// ---------- email signature ----------
adminRouter.get("/cards/:id/signature", async (req, res) => {
  const card = await prisma.card.findUnique({
    where: { id: req.params.id },
    include: { location: { include: { brand: true } }, template: true, dept: true },
  });
  if (!card) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);
  const dealer = mergeCtas(
    mergeCtas(ctasFromJson((card.dept as any)?.ctas), ctasFromJson((card.template as any)?.roleCtas)),
    rooftopCtas(card.location as any)
  );
  const ctas = dealer.slice(0, 2).map((c) => ({ label: c.label, href: c.href }));
  const model = buildSignatureModel(card, { cardBaseUrl: config.cardUrl, ctas });
  const block = signatureBlock(renderSignatureHtml(model), renderSignatureText(model));
  res.send(V.signaturePreviewView([card.firstName, card.lastName].filter(Boolean).join(" "), card.id, block));
});

// ---------- turnover / offboarding ----------
adminRouter.get("/cards/:id/turnover", async (req, res) => {
  const card = await prisma.card.findUnique({ where: { id: req.params.id }, include: { location: true } });
  if (!card) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);
  const [otherCards, leadCount] = await Promise.all([
    prisma.card.findMany({
      where: { locationId: card.locationId, active: true, id: { not: card.id } },
      select: { id: true, slug: true, firstName: true, lastName: true, title: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.lead.count({ where: { cardId: card.id } }),
  ]);
  res.send(V.turnoverForm({ card, rooftop: card.location, otherCards, leadCount }));
});

adminRouter.post("/cards/:id/turnover", async (req, res) => {
  const b = req.body;
  const card = await prisma.card.findUnique({ where: { id: req.params.id }, include: { location: true } });
  if (!card) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);

  // Redirect target: validate a card:<slug> choice against an active card in this rooftop.
  let choice = clean(b.redirect) || "none";
  if (choice.startsWith("card:")) {
    const ok = await prisma.card.count({
      where: { slug: choice.slice(5), locationId: card.locationId, active: true },
    });
    if (!ok) choice = "none";
  }
  const redirectUrl = redirectTargetUrl(choice, {
    cardBaseUrl: config.cardUrl,
    rooftopWebsite: card.location.website,
  });

  // Transfer leads to another card in the rooftop (validated), or keep them.
  const transfer = clean(b.transferLeads);
  if (transfer && transfer !== "keep") {
    const target = await prisma.card.findFirst({
      where: { id: transfer, locationId: card.locationId },
      select: { id: true },
    });
    if (target) await prisma.lead.updateMany({ where: { cardId: card.id }, data: { cardId: target.id } });
  }

  // Offboard: disable the public card, revoke self-service, set the redirect.
  await prisma.card.update({ where: { id: card.id }, data: offboardCardUpdate(redirectUrl) });

  // Optional replacement: clone role/design/placement, assign the new hire.
  if (b.createReplacement) {
    const first = clean(b.newFirstName);
    const last = clean(b.newLastName);
    if (first || last) {
      const data: any = replacementCardData(card);
      if (data.selfEditFields == null) delete data.selfEditFields;
      const slug = await uniqueSlug(first || "new", last || "hire");
      let replacement;
      try {
        replacement = await withOrgLimit(card.orgId, "cards", () =>
          prisma.card.create({
            data: {
              orgId: card.orgId,
              slug,
              firstName: first || "New",
              lastName: last || "Hire",
              ownerEmail: clean(b.newOwnerEmail),
              ...data,
            },
          })
        );
      } catch (e) {
        if (isOrgLimitReached(e)) return limitReached(res, "card");
        throw e;
      }
      emitEvent(replacement.orgId, "card.created", cardPayload(replacement));
    }
  }

  res.redirect(`/admin/cards?locationId=${card.locationId}`);
});

// Printable CR80 ID card PDF (badge printers): photo, logo, name, title,
// black QR to the public card. ?orientation=portrait for vertical badges.
adminRouter.get("/cards/:id/idcard.pdf", async (req, res) => {
  const card = await prisma.card.findUnique({
    where: { id: req.params.id },
    include: { location: { include: { brand: true } }, template: true },
  });
  if (!card) return res.status(404).send("Not found");
  if (!(await RBAC.canAccessLocation(reqAdmin(req), card.locationId))) return forbidden(res);
  const orientation = req.query.orientation === "portrait" ? "portrait" : "landscape";
  const withBack = req.query.back === "1";
  const brandBack = (card.location.brand as any).idCardBack === "triangles" ? "triangles" : "cubes";
  const backStyle =
    req.query.backstyle === "triangles" ? ("triangles" as const) : req.query.backstyle === "cubes" ? ("cubes" as const) : brandBack;
  const primary = card.primaryColor || card.template?.primaryColor || card.location.primaryColor || card.location.brand.primaryColor;
  const pdf = await buildIdCardPdf(
    {
      firstName: card.firstName,
      lastName: card.lastName,
      title: card.title,
      photoUrl: card.photoUrl,
      logoUrl: card.logoUrl || card.location.logoUrl || card.location.brand.logoUrl,
      slug: card.slug,
      primaryColor: primary,
      orgName: card.company || card.location.brand.name,
      layout: card.layout || card.template?.layout || card.location.layout || card.location.brand.layout,
    },
    orientation,
    withBack,
    backStyle
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${card.slug}-idcard-${orientation}${withBack ? "-2sided" : ""}.pdf"`);
  // Diagnostics: what the server resolved (helps support debug style issues).
  res.setHeader("X-Idcard-Style", `${backStyle};brand=${String((card.location.brand as any).idCardBack)};layout=${String(card.layout || card.template?.layout || card.location.layout || card.location.brand.layout || "")}`);
  res.send(pdf);
});

// Card ids the principal may see (null = no restriction, i.e. global admin).

}
