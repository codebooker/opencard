import { Router, Request } from "express";
import { prisma, runWithOrg } from "../db";
import { resolveOrgId } from "../tenant-resolver";
import { config } from "../config";
import { buildVCard } from "../vcard";
import { qrPng, qrDataUrl } from "../qr";
import { renderCardPage } from "../views/card";
import { page, esc } from "../views/html";
import { emitEvent, leadPayload } from "../webhooks";

export const cardsRouter = Router();

function clientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
}

// Public read. Scoped to the org resolved from the request host so that, once
// custom domains / subdomains are live, a host only ever serves its own org's
// cards. With a single org (and no host mapping) this resolves to the default
// org, so behavior is unchanged today. Uses the owner client: card pages are
// public, and the slug→org lookup must work before any tenant context exists.
async function loadCard(slug: string, orgId: string) {
  return prisma.card.findFirst({
    where: { slug, active: true, orgId },
    include: { location: { include: { brand: true } }, template: true },
  });
}

function cardPrimary(card: { primaryColor: string | null; location: { primaryColor: string | null; brand: { primaryColor: string } } }) {
  return card.primaryColor || card.location.primaryColor || card.location.brand.primaryColor;
}

// Public card page
cardsRouter.get("/:slug", async (req, res) => {
  const card = await loadCard(req.params.slug, await resolveOrgId(req));
  if (!card) return res.status(404).send(page({ title: "Not found", body: "<main class='card'><p>Card not found.</p></main>" }));

  await runWithOrg(card.orgId, (db) =>
    db.analyticsEvent.create({
      data: { cardId: card.id, orgId: card.orgId, type: "view", ip: clientIp(req), userAgent: req.headers["user-agent"] || "" },
    })
  );

  // Non-destructive preview overrides (do NOT change saved data):
  //   /c/:slug?layout=wave&photo=<url>&logo=<url>
  const previewLayout = String(req.query.layout || "");
  if (["classic", "banner", "minimal", "wave"].includes(previewLayout)) {
    (card as any).layout = previewLayout;
  }
  const previewPhoto = String(req.query.photo || "");
  if (/^https:\/\//.test(previewPhoto)) (card as any).photoUrl = previewPhoto;
  const previewLogo = String(req.query.logo || "");
  if (/^https:\/\//.test(previewLogo)) (card as any).logoUrl = previewLogo;

  const primary = cardPrimary(card);
  const qr = await qrDataUrl(`${config.baseUrl}/c/${card.slug}`, primary);
  res.send(renderCardPage(card, qr, config.baseUrl));
});

// vCard download (Add to Contacts)
cardsRouter.get("/:slug/vcard", async (req, res) => {
  const card = await loadCard(req.params.slug, await resolveOrgId(req));
  if (!card) return res.status(404).send("Not found");
  await runWithOrg(card.orgId, (db) =>
    db.analyticsEvent.create({ data: { cardId: card.id, orgId: card.orgId, type: "vcard", ip: clientIp(req) } })
  );
  const vcf = buildVCard(card);
  res.setHeader("Content-Type", "text/vcard; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${card.slug}.vcf"`);
  res.send(vcf);
});

// QR PNG (for printing on badges, signatures, etc.)
cardsRouter.get("/:slug/qr.png", async (req, res) => {
  const card = await loadCard(req.params.slug, await resolveOrgId(req));
  if (!card) return res.status(404).send("Not found");
  const primary = cardPrimary(card);
  const buf = await qrPng(`${config.baseUrl}/c/${card.slug}`, primary);
  res.setHeader("Content-Type", "image/png");
  res.send(buf);
});

// Click / interaction beacon
cardsRouter.post("/:slug/event", async (req, res) => {
  const card = await prisma.card.findUnique({ where: { slug: req.params.slug } });
  if (!card) return res.status(204).end();
  let type = "click";
  let meta: string | undefined;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (body?.type) {
      const parts = String(body.type).split(":");
      type = parts[0] || "click";
      meta = parts.slice(1).join(":") || undefined;
    }
  } catch {
    /* ignore malformed beacons */
  }
  await runWithOrg(card.orgId, (db) =>
    db.analyticsEvent.create({
      data: { cardId: card.id, orgId: card.orgId, type, meta, ip: clientIp(req), userAgent: req.headers["user-agent"] || "" },
    })
  );
  res.status(204).end();
});

// Two-way contact sharing — capture a lead
cardsRouter.post("/:slug/connect", async (req, res) => {
  const card = await loadCard(req.params.slug, await resolveOrgId(req));
  if (!card) return res.status(404).send("Not found");
  const { name, email, phone, company, note } = req.body || {};
  if (!name) return res.status(400).send("Name required");
  const lead = await runWithOrg(card.orgId, async (db) => {
    const created = await db.lead.create({
      data: {
        cardId: card.id,
        orgId: card.orgId,
        name: String(name).slice(0, 200),
        email: email ? String(email).slice(0, 200) : null,
        phone: phone ? String(phone).slice(0, 60) : null,
        company: company ? String(company).slice(0, 200) : null,
        note: note ? String(note).slice(0, 1000) : null,
      },
    });
    await db.analyticsEvent.create({ data: { cardId: card.id, orgId: card.orgId, type: "connect", ip: clientIp(req) } });
    return created;
  });
  emitEvent("lead.captured", leadPayload(lead, card));
  res.send(
    page({
      title: "Thanks!",
      body: `<main class="card" style="--primary:${esc(
        cardPrimary(card)
      )}"><section class="ident"><h1>Thanks!</h1><p class="company">Your details were sent to ${esc(
        [card.firstName, card.lastName].join(" ")
      )}.</p></section><a class="cta" href="/c/${esc(card.slug)}">Back to card</a></main>`,
    })
  );
});
