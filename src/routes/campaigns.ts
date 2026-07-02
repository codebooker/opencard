import { Router } from "express";
import { prisma } from "../db";
import { campaignRedirectUrl, normalizeCampaignCode } from "../marketing";

// Public campaign short links: /k/:code -> 302 to the landing URL with the
// campaign's UTM params appended, counting the click.
export const campaignRouter = Router();

campaignRouter.get("/:code", async (req, res) => {
  const code = normalizeCampaignCode(req.params.code);
  const c = code ? await prisma.campaign.findUnique({ where: { code } }) : null;
  if (!c || !c.active) return res.status(404).send("Campaign link not found.");
  prisma.campaign.update({ where: { id: c.id }, data: { clicks: { increment: 1 } } }).catch(() => {});
  const url = campaignRedirectUrl(c.landingUrl, {
    source: c.utmSource,
    medium: c.utmMedium,
    campaign: c.utmCampaign,
    codeFallback: c.code,
  });
  return res.redirect(302, url);
});
