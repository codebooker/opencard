import { Router, Request } from "express";
import { prisma, runWithOrg } from "../db";
import { config } from "../config";
import { qrPng } from "../qr";
import { orgIdForHost, requestHost } from "../tenant-resolver";
import { resolveAssetDestination } from "../assets";
import { renderAssetLanding } from "../views/asset";
import { page, esc } from "../views/html";
import { parseUtm } from "../attribution";
import { assembleLead } from "../leadform";
import { emitEvent, leadPayload } from "../webhooks";
import { notifyLead } from "../notify";

export const assetsRouter = Router();
const hostOrg = (req: Request) => orgIdForHost(requestHost(req));

const notFound = (res: any, msg = "Not found.") =>
  res.status(404).send(page({ title: "Not found", body: `<main class='card'><p>${msg}</p></main>` }));

async function loadAsset(slug: string, orgId: string | null) {
  return prisma.asset.findFirst({
    where: { slug, active: true, ...(orgId ? { orgId } : {}) },
    include: {
      location: { include: { brand: true } },
      destinationCard: { select: { slug: true, active: true } },
    },
  });
}

// Public asset: record the scan, then redirect or render a landing page.
assetsRouter.get("/:slug", async (req, res) => {
  const orgId = await hostOrg(req);
  const asset = await loadAsset(req.params.slug, orgId);
  if (!asset) return notFound(res);

  await runWithOrg(asset.orgId, (db) =>
    db.asset.update({
      where: { id: asset.id },
      data: { scanCount: { increment: 1 }, lastScanAt: new Date() },
    })
  );

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
  if (dest.kind === "landing") return res.send(renderAssetLanding(asset, config.cardUrl, parseUtm(req.query as any)));
  return notFound(res, "This code isn't set up yet.");
});

// Lead capture from an asset landing page.
assetsRouter.post("/:slug/connect", async (req, res) => {
  const asset = await loadAsset(req.params.slug, await hostOrg(req));
  if (!asset) return notFound(res);
  const b = req.body || {};
  if (!b.name) return res.status(400).send("Name required");
  const data = assembleLead(b, req.headers["user-agent"] as string);
  const lead = await runWithOrg(asset.orgId, (db) =>
    db.lead.create({ data: { assetId: asset.id, orgId: asset.orgId, ...data } })
  );
  emitEvent("lead.captured", leadPayload(lead, { asset }));
  notifyLead(lead, { asset });
  res.send(
    page({
      title: "Thanks!",
      body: `<main class="card"><section class="ident"><h1>Thanks!</h1><p class="company">Your details were sent to ${esc(
        asset.location.name
      )}.</p></section></main>`,
      bodyClass: "card-body",
    })
  );
});

// Printable QR for the asset.
assetsRouter.get("/:slug/qr.png", async (req, res) => {
  const asset = await loadAsset(req.params.slug, await hostOrg(req));
  if (!asset) return res.status(404).send("Not found");
  const primary = asset.location.primaryColor || asset.location.brand.primaryColor;
  const buf = await qrPng(`${config.cardUrl}/a/${asset.slug}`, primary);
  res.setHeader("Content-Type", "image/png");
  res.send(buf);
});
