import { Router, Request } from "express";
import { prisma, runWithOrg } from "../db";
import { config } from "../config";
import { qrSvg, resolveQrDesign } from "../qr-style";
import { styledQrPng } from "../qr-render";
import { geoFields } from "../geo";
import { orgIdForHost, requestHost } from "../tenant-resolver";
import { resolveAssetDestination } from "../assets";
import { renderAssetLanding } from "../views/asset";
import { page, esc } from "../views/html";
import { parseUtm } from "../attribution";
import { assembleLead } from "../leadform";
import { emitEvent, leadPayload } from "../webhooks";
import { notifyLead } from "../notify";
import { syncLeadToCrm } from "../crmsync-dispatch";
import { orgAnalyticsHead } from "../marketing-tags";
import { eventLive } from "../event";
import { findDuplicate } from "../leadstatus";

export const assetsRouter = Router();
const hostOrg = (req: Request) => orgIdForHost(requestHost(req));

const notFound = (res: any, msg = "Not found.") =>
  res.status(404).send(page({ title: "Not found", body: `<main class='card'><p>${msg}</p></main>` }));

async function loadAsset(slug: string, orgId: string | null) {
  return prisma.asset.findFirst({
    // org.suspended gates every public surface for a suspended client.
    where: { slug, active: true, org: { suspended: false, ownerVerifiedAt: { not: null } }, ...(orgId ? { orgId } : {}) },
    include: {
      location: { include: { brand: true } },
      destinationCard: { select: { slug: true, active: true } },
      event: true,
      org: { select: { vertical: true } },
    },
  });
}

// Public asset: record the scan, then redirect or render a landing page.
assetsRouter.get("/:slug", async (req, res) => {
  const orgId = await hostOrg(req);
  const asset = await loadAsset(req.params.slug, orgId);
  if (!asset) return notFound(res);

  // Event QR codes only resolve while the event is live.
  if (asset.event && !eventLive(asset.event)) {
    return notFound(res, "This event QR code isn't active right now.");
  }

  const ip = req.ip || req.socket.remoteAddress || "";
  await runWithOrg(asset.orgId, async (db) => {
    await db.asset.update({
      where: { id: asset.id },
      data: { scanCount: { increment: 1 }, lastScanAt: new Date() },
    });
    // Scan event row carries rough location for analytics.
    await db.analyticsEvent.create({
      data: {
        assetId: asset.id,
        orgId: asset.orgId,
        type: "scan",
        ip,
        userAgent: req.headers["user-agent"] || "",
        ...geoFields(ip),
      },
    });
  });

  const dest = resolveAssetDestination(
    {
      destinationType: asset.destinationType,
      destinationUrl: asset.destinationUrl,
      // only redirect to a card if it still exists and is active
      destinationCardSlug: asset.destinationCard?.active ? asset.destinationCard.slug : null,
    },
    asset.location as any,
    { cardBaseUrl: config.cardUrl }
  );

  if (dest.kind === "redirect") return res.redirect(302, dest.url);
  if (dest.kind === "landing")
    return res.send(renderAssetLanding(asset, config.cardUrl, parseUtm(req.query as any), await orgAnalyticsHead(asset.orgId)));
  return notFound(res, "This code isn't set up yet.");
});

// Lead capture from an asset landing page.
assetsRouter.post("/:slug/connect", async (req, res) => {
  const asset = await loadAsset(req.params.slug, await hostOrg(req));
  if (!asset) return notFound(res);
  const b = req.body || {};
  if (!b.name) return res.status(400).send("Name required");
  const data = assembleLead(b, req.headers["user-agent"] as string);
  const lead = await runWithOrg(asset.orgId, async (db) => {
    const recent = await db.lead.findMany({
      where: { assetId: asset.id, createdAt: { gte: new Date(Date.now() - 30 * 864e5) } },
      select: { id: true, email: true, phone: true },
    });
    const duplicateOfId = findDuplicate({ email: data.email, phone: data.phone }, recent);
    return db.lead.create({
      data: {
        assetId: asset.id,
        orgId: asset.orgId,
        duplicateOfId,
        ...data,
        ...geoFields(req.ip || req.socket.remoteAddress || ""),
      },
    });
  });
  emitEvent("lead.captured", leadPayload(lead, { asset }));
  notifyLead(lead, { asset });
  syncLeadToCrm(lead, { asset });
  res.send(
    page({
      title: "Thanks!",
      body: `<main class="card"><section class="ident"><h1>Thanks!</h1><p class="company">Your details were sent to ${esc(
        asset.location.name
      )}.</p></section></main>`,
      bodyClass: "card-body",
      noUserway: true,
    })
  );
});

// Printable QR for the asset — same styled design as qr.svg, rasterized.
assetsRouter.get("/:slug/qr.png", async (req, res) => {
  const asset = await loadAsset(req.params.slug, await hostOrg(req));
  if (!asset) return res.status(404).send("Not found");
  const primary = asset.location.primaryColor || asset.location.brand.primaryColor;
  const design = resolveQrDesign(asset.qrDesign, asset.location.brand.qrDesign, primary);
  const size = Math.max(200, Math.min(2000, parseInt(String(req.query.size || ""), 10) || 600));
  const buf = await styledQrPng(`${config.cardUrl}/a/${asset.slug}`, design, primary, size);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(buf);
});

// Styled QR SVG — designed version (colors/gradient/dots/logo).
assetsRouter.get("/:slug/qr.svg", async (req, res) => {
  const asset = await loadAsset(req.params.slug, await hostOrg(req));
  if (!asset) return res.status(404).send("Not found");
  const primary = asset.location.primaryColor || asset.location.brand.primaryColor;
  const design = resolveQrDesign(asset.qrDesign, asset.location.brand.qrDesign, primary);
  const size = parseInt(String(req.query.size || ""), 10) || 600;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(qrSvg(`${config.cardUrl}/a/${asset.slug}`, design, { size }));
});
