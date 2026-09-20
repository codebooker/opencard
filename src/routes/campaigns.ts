import { Router, Request } from "express";
import { prisma, runWithOrg } from "../db";
import { config } from "../config";
import { campaignRedirectUrl, normalizeCampaignCode } from "../marketing";
import { qrSvg, resolveQrDesign } from "../qr-style";
import { geoFields } from "../geo";
import { orgIdForHost, requestHost } from "../tenant-resolver";

// Public campaign short links: /k/:code -> 302 to the landing URL with the
// campaign's UTM params appended, counting the click (with rough location).
export const campaignRouter = Router();

async function loadCampaign(rawCode: string, orgId: string | null) {
  const code = normalizeCampaignCode(rawCode);
  if (!code) return null;
  return prisma.campaign.findFirst({
    where: { code, ...(orgId ? { orgId } : {}) },
  });
}
const hostOrg = (req: Request) => orgIdForHost(requestHost(req));

campaignRouter.get("/:code", async (req, res) => {
  const c = await loadCampaign(req.params.code, await hostOrg(req));
  if (!c || !c.active) return res.status(404).send("Campaign link not found.");
  const ip = req.ip || req.socket.remoteAddress || "";
  runWithOrg(c.orgId, async (db) => {
    await db.campaign.update({ where: { id: c.id }, data: { clicks: { increment: 1 } } });
    await db.analyticsEvent.create({
      data: {
        campaignId: c.id,
        orgId: c.orgId,
        type: "click",
        ip,
        userAgent: req.headers["user-agent"] || "",
        ...geoFields(ip),
      },
    });
  }).catch(() => {});
  const url = campaignRedirectUrl(c.landingUrl, {
    source: c.utmSource,
    medium: c.utmMedium,
    campaign: c.utmCampaign,
    codeFallback: c.code,
  });
  return res.redirect(302, url);
});

// Styled QR SVG for the campaign short link.
campaignRouter.get("/:code/qr.svg", async (req, res) => {
  const c = await loadCampaign(req.params.code, await hostOrg(req));
  if (!c || !c.active) return res.status(404).send("Not found");
  const design = resolveQrDesign(c.qrDesign, null, null);
  const size = parseInt(String(req.query.size || ""), 10) || 600;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(qrSvg(`${config.cardUrl}/k/${c.code}`, design, { size }));
});
