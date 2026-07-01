import { Router, Request } from "express";
import { prisma, runWithOrg } from "../db";
import { orgIdForHost, requestHost } from "../tenant-resolver";
import { config } from "../config";
import { buildVCard } from "../vcard";
import { qrPng, qrDataUrl } from "../qr";
import { renderCardPage } from "../views/card";
import { page, esc } from "../views/html";
import { emitEvent, leadPayload } from "../webhooks";
import { parseUtm, deviceFromUa, normalizePreferredContact, cleanReferrer } from "../attribution";

export const cardsRouter = Router();

function clientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
}

// Public read. When the request host maps to a specific tenant (a subdomain
// under the platform domain, or a custom domain), we scope to that org so the
// host only serves its own cards. On the shared card domain (tapshare.cards) or
// an unmapped host, orgId is null and we serve any card by its globally-unique
// slug. Uses the owner client: card pages are public and the lookup must work
// before any tenant context exists.
async function loadCard(slug: string, orgId: string | null) {
  return prisma.card.findFirst({
    where: { slug, active: true, ...(orgId ? { orgId } : {}) },
    include: { location: { include: { brand: true } }, template: true, dept: true },
  });
}
const hostOrg = (req: Request) => orgIdForHost(requestHost(req));

function cardPrimary(card: { primaryColor: string | null; location: { primaryColor: string | null; brand: { primaryColor: string } } }) {
  return card.primaryColor || card.location.primaryColor || card.location.brand.primaryColor;
}

// Public card page
cardsRouter.get("/:slug", async (req, res) => {
  const orgId = await hostOrg(req);
  const card = await loadCard(req.params.slug, orgId);
  if (!card) {
    // Turnover: a deactivated card can redirect scanned NFC/QR visitors onward.
    const dead = await prisma.card.findFirst({
      where: { slug: req.params.slug, active: false, ...(orgId ? { orgId } : {}) },
      select: { redirectUrl: true },
    });
    if (dead?.redirectUrl) return res.redirect(302, dead.redirectUrl);
    return res.status(404).send(page({ title: "Not found", body: "<main class='card'><p>Card not found.</p></main>" }));
  }

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
  const qr = await qrDataUrl(`${config.cardUrl}/c/${card.slug}`, primary);
  res.send(renderCardPage(card, qr, config.cardUrl, parseUtm(req.query as any)));
});

// vCard download (Add to Contacts)
cardsRouter.get("/:slug/vcard", async (req, res) => {
  const card = await loadCard(req.params.slug, await hostOrg(req));
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
  const card = await loadCard(req.params.slug, await hostOrg(req));
  if (!card) return res.status(404).send("Not found");
  const primary = cardPrimary(card);
  const buf = await qrPng(`${config.cardUrl}/c/${card.slug}`, primary);
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
  const card = await loadCard(req.params.slug, await hostOrg(req));
  if (!card) return res.status(404).send("Not found");
  const b = req.body || {};
  const { name, email, phone, company, note } = b;
  if (!name) return res.status(400).send("Name required");
  const str = (v: any, n: number) => (v ? String(v).slice(0, n) : null);
  const utm = parseUtm(b as any); // UTM/campaign carried as hidden fields from the card page
  const lead = await runWithOrg(card.orgId, async (db) => {
    const created = await db.lead.create({
      data: {
        cardId: card.id,
        orgId: card.orgId,
        name: String(name).slice(0, 200),
        email: str(email, 200),
        phone: str(phone, 60),
        company: str(company, 200),
        note: str(note, 1000),
        // dealership fields
        preferredContact: normalizePreferredContact(b.preferredContact),
        vehicleInterest: str(b.vehicleInterest, 200),
        tradeIn: b.tradeIn === "1",
        serviceNeed: str(b.serviceNeed, 200),
        appointmentRequest: b.appointmentRequest === "1",
        consent: b.consent === "1",
        // attribution
        campaign: utm.campaign,
        utmSource: utm.utmSource,
        utmMedium: utm.utmMedium,
        utmCampaign: utm.utmCampaign,
        referrer: cleanReferrer(b.referrer),
        device: deviceFromUa(req.headers["user-agent"] as string),
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
