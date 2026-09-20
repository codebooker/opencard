import { Router, Request } from "express";
import { prisma, runWithOrg } from "../db";
import { orgIdForHost, requestHost } from "../tenant-resolver";
import { config } from "../config";
import { buildVCard } from "../vcard";
import { qrSvg, resolveQrDesign } from "../qr-style";
import { styledQrPng } from "../qr-render";
import { geoFields } from "../geo";
import { renderCardPage } from "../views/card";
import { page, esc } from "../views/html";
import { emitEvent, leadPayload } from "../webhooks";
import { parseUtm } from "../attribution";
import { assembleLead, defaultLeadFieldsFor, leadSubmissionError, resolveLeadFields } from "../leadform";
import { notifyLead } from "../notify";
import { syncLeadToCrm } from "../crmsync-dispatch";
import { orgAnalyticsHead } from "../marketing-tags";
import { appleWalletEnabled, googleWalletEnabled } from "../config";
import { buildGoogleGenericObject, googleSaveClaims, googleSaveUrl } from "../wallet";
import { signGoogleJwt } from "../wallet-sign";
import { findDuplicate } from "../leadstatus";

export const cardsRouter = Router();

// req.ip honors the `trust proxy` hop count configured in server.ts; never read
// X-Forwarded-For directly (leftmost value is client-controlled).
function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "";
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
    include: { location: { include: { brand: true } }, template: true, dept: true, org: { select: { vertical: true } } },
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
      data: {
        cardId: card.id,
        orgId: card.orgId,
        type: "view",
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] || "",
        ...geoFields(clientIp(req)),
      },
    })
  );

  const primary = cardPrimary(card);
  const design = resolveQrDesign(card.qrDesign, card.location.brand.qrDesign, primary);
  const svg = qrSvg(`${config.cardUrl}/c/${card.slug}`, design, { size: 240, margin: 1 });
  const qr = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  res.send(
    renderCardPage(card, qr, config.cardUrl, parseUtm(req.query as any), await orgAnalyticsHead(card.orgId), {
      apple: appleWalletEnabled,
      google: googleWalletEnabled,
    })
  );
});

// Save to Google Wallet: build + RS256-sign a save JWT, redirect to the save URL.
cardsRouter.get("/:slug/wallet/google", async (req, res) => {
  if (!googleWalletEnabled) return res.status(404).send("Google Wallet isn't configured on this instance.");
  const card = await loadCard(req.params.slug, await hostOrg(req));
  if (!card) return res.status(404).send("Not found");
  const cardUrl = `${config.cardUrl}/c/${card.slug}`;
  const obj = buildGoogleGenericObject(card, config.wallet.googleIssuerId, cardUrl);
  const claims = googleSaveClaims(obj, { serviceEmail: config.wallet.googleServiceEmail, origins: [config.cardUrl] });
  const jwt = signGoogleJwt(claims, config.wallet.googleServiceKey);
  runWithOrg(card.orgId, (db) =>
    db.analyticsEvent.create({
      data: { cardId: card.id, orgId: card.orgId, type: "wallet", meta: "google", ip: clientIp(req), ...geoFields(clientIp(req)) },
    })
  ).catch(() => {});
  return res.redirect(302, googleSaveUrl(jwt));
});

// Add to Apple Wallet (.pkpass). Requires the Apple Pass Type ID cert/key/WWDR to
// package + sign the pass; inert until those are configured.
cardsRouter.get("/:slug/wallet/apple.pkpass", async (req, res) => {
  if (!appleWalletEnabled) return res.status(404).send("Apple Wallet isn't configured on this instance.");
  const card = await loadCard(req.params.slug, await hostOrg(req));
  if (!card) return res.status(404).send("Not found");
  // pass.json is built by buildApplePass(); .pkpass packaging (manifest + PKCS#7
  // signature via openssl + zip) is wired once the Apple certs are provided.
  return res.status(501).send("Apple Wallet packaging is pending certificate configuration.");
});

// vCard download (Add to Contacts)
cardsRouter.get("/:slug/vcard", async (req, res) => {
  const card = await loadCard(req.params.slug, await hostOrg(req));
  if (!card) return res.status(404).send("Not found");
  await runWithOrg(card.orgId, (db) =>
    db.analyticsEvent.create({
      data: { cardId: card.id, orgId: card.orgId, type: "vcard", ip: clientIp(req), ...geoFields(clientIp(req)) },
    })
  );
  const vcf = buildVCard(card);
  res.setHeader("Content-Type", "text/vcard; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${card.slug}.vcf"`);
  res.send(vcf);
});

// QR PNG (for printing on badges, signatures, etc.) — same styled design as
// qr.svg, rasterized. Falls back to plain single-color if rendering fails.
cardsRouter.get("/:slug/qr.png", async (req, res) => {
  const card = await loadCard(req.params.slug, await hostOrg(req));
  if (!card) return res.status(404).send("Not found");
  const primary = cardPrimary(card);
  const design = resolveQrDesign(card.qrDesign, card.location.brand.qrDesign, primary);
  const size = Math.max(200, Math.min(2000, parseInt(String(req.query.size || ""), 10) || 600));
  const buf = await styledQrPng(`${config.cardUrl}/c/${card.slug}`, design, primary, size);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(buf);
});

// Styled QR SVG — the designed version (colors/gradient/dots/logo), crisp at
// any print size. ?size=… bounds the rendered pixel size.
cardsRouter.get("/:slug/qr.svg", async (req, res) => {
  const card = await loadCard(req.params.slug, await hostOrg(req));
  if (!card) return res.status(404).send("Not found");
  const design = resolveQrDesign(card.qrDesign, card.location.brand.qrDesign, cardPrimary(card));
  const size = parseInt(String(req.query.size || ""), 10) || 600;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(qrSvg(`${config.cardUrl}/c/${card.slug}`, design, { size }));
});

// Click / interaction beacon. Host/org-scoped like every other card lookup so
// a tenant host can't write analytics events onto another org's card.
cardsRouter.post("/:slug/event", async (req, res) => {
  const orgId = await hostOrg(req);
  const card = await prisma.card.findFirst({
    where: { slug: req.params.slug, active: true, ...(orgId ? { orgId } : {}) },
    select: { id: true, orgId: true },
  });
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
      data: {
        cardId: card.id,
        orgId: card.orgId,
        type,
        meta,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] || "",
        ...geoFields(clientIp(req)),
      },
    })
  );
  res.status(204).end();
});

// Two-way contact sharing — capture a lead
cardsRouter.post("/:slug/connect", async (req, res) => {
  const card = await loadCard(req.params.slug, await hostOrg(req));
  if (!card) return res.status(404).send("Not found");
  const b = req.body || {};
  const leadFields = resolveLeadFields(
    card.template?.leadFields,
    card.location.brand.leadFields,
    defaultLeadFieldsFor(card.org.vertical)
  );
  const validationError = leadSubmissionError(b, leadFields);
  if (validationError) return res.status(400).send(validationError);
  const data = assembleLead(b, req.headers["user-agent"] as string);
  const lead = await runWithOrg(card.orgId, async (db) => {
    // Duplicate detection: match a recent lead on this card by email/phone.
    const recent = await db.lead.findMany({
      where: { cardId: card.id, createdAt: { gte: new Date(Date.now() - 30 * 864e5) } },
      select: { id: true, email: true, phone: true },
    });
    const duplicateOfId = findDuplicate({ email: data.email, phone: data.phone }, recent);
    const created = await db.lead.create({
      data: { cardId: card.id, orgId: card.orgId, duplicateOfId, ...data, ...geoFields(clientIp(req)) },
    });
    await db.analyticsEvent.create({
      data: { cardId: card.id, orgId: card.orgId, type: "connect", ip: clientIp(req), ...geoFields(clientIp(req)) },
    });
    return created;
  });
  emitEvent(card.orgId, "lead.captured", leadPayload(lead, { card }));
  notifyLead(lead, { card });
  syncLeadToCrm(lead, { card });
  res.send(
    page({
      title: "Thanks!",
      body: `<main class="card" style="--primary:${esc(
        cardPrimary(card)
      )}"><section class="ident"><h1>Thanks!</h1><p class="company">Your details were sent to ${esc(
        [card.firstName, card.lastName].join(" ")
      )}.</p></section><a class="cta" href="/c/${esc(card.slug)}">Back to card</a></main>`,
      noUserway: true,
    })
  );
});
