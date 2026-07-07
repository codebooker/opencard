// Admin route group: integrations (split from admin.ts, CQ-05).
import {
  Router, Address, WEBHOOK_EVENTS, asArray, audit, canAdd, clean, config,
  crypto, ensureFeature, esc, forbidden, fs, generateApiKey, generateScimToken, getSamlConfigForOrg,
  isGaId, isGtmId, limitReached, mdToHtml, normalizeCampaignCode, orgCanonicalHost, page, parseFieldMapLines,
  path, postChatWebhook, prisma, replayDelivery, reqAdmin, retrySync, samlAcsUrl, samlSpIssuer,
  sanitizeScopes, seal, sendTestEvent, sendTestSync, validateOutboundUrl,
} from "./context";
import { RBAC } from "./context";
import { V } from "./context";

export function registerIntegrationRoutes(router: Router) {
  const adminRouter = router;

// ---------- integrations: API keys + webhooks + SCIM ----------
// API keys and webhooks are per-org; only platform owners see across orgs.
async function renderIntegrations(res: any, p: RBAC.AdminPrincipal, newKey: string | null = null, newScimToken: string | null = null, newWebhookSecret: string | null = null) {
  const orgFilter = RBAC.seesAllOrgs(p) ? {} : { orgId: p.orgId };
  const [keys, endpoints, saml, org, crmIntegrations, crmLocations] = await Promise.all([
    prisma.apiKey.findMany({ where: orgFilter, orderBy: { createdAt: "desc" } }),
    prisma.webhookEndpoint.findMany({
      where: orgFilter,
      orderBy: { createdAt: "desc" },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    getSamlConfigForOrg(p.orgId),
    prisma.org.findUnique({
      where: { id: p.orgId },
      select: { scimTokenHash: true, subdomain: true, customDomain: true, leadWebhookUrl: true },
    }),
    prisma.crmIntegration.findMany({
      where: orgFilter,
      orderBy: { createdAt: "desc" },
      include: { syncLogs: { orderBy: { updatedAt: "desc" }, take: 5 } },
    }),
    prisma.location.findMany({ where: orgFilter, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const samlHost = org ? orgCanonicalHost(org) : null;
  res.send(
    V.integrationsView({
      keys,
      endpoints,
      events: WEBHOOK_EVENTS,
      newKey,
      baseUrl: config.baseUrl,
      saml,
      samlIssuer: samlHost ? samlSpIssuer(samlHost) : "",
      samlAcsUrl: samlHost ? samlAcsUrl(samlHost) : "",
      samlHost,
      subdomain: org?.subdomain ?? null,
      customDomain: org?.customDomain ?? null,
      platformDomain: process.env.PLATFORM_DOMAIN || "",
      scimBaseUrl: `${config.baseUrl}/scim/v2`,
      scimTokenSet: !!org?.scimTokenHash,
      newScimToken,
      crmIntegrations,
      crmLocations,
      leadWebhookUrl: org?.leadWebhookUrl || "",
      newWebhookSecret,
    })
  );
}

adminRouter.get("/integrations", (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  return renderIntegrations(res, p);
});

// ---------- lead alerts to Slack / Teams (Phase 14) ----------
adminRouter.post("/lead-webhook", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const url = clean(req.body?.leadWebhookUrl) || null;
  if (url) {
    const chk = validateOutboundUrl(url);
    if (!chk.ok) return res.status(400).send(chk.error || "Invalid webhook URL.");
  }
  await prisma.org.update({ where: { id: p.orgId }, data: { leadWebhookUrl: url } });
  audit(req, p, "leadwebhook.update", { summary: url ? "set" : "cleared" });
  res.redirect("/admin/integrations");
});

adminRouter.post("/lead-webhook/test", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const org = await prisma.org.findUnique({ where: { id: p.orgId }, select: { leadWebhookUrl: true, name: true } });
  if (!org?.leadWebhookUrl) return res.status(400).send("Save a webhook URL first.");
  const r = await postChatWebhook(org.leadWebhookUrl, `✅ OpenCard test — lead alerts for ${org.name} will arrive here.`);
  res.send(
    page({
      title: "Webhook test",
      body: `<main class="card" style="padding:32px"><p>${
        r.ok ? "Test message sent — check the channel." : `Test failed: ${esc(r.error || "unknown error")}`
      }</p><p><a href="/admin/integrations">← Back to integrations</a></p></main>`,
    })
  );
});

// ---------- API reference (Phase 14): docs/API.md rendered in-app ----------
let apiDocsCache: string | null = null;
adminRouter.get("/api-docs", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  if (!apiDocsCache) {
    try {
      const raw = fs.readFileSync(path.join(process.cwd(), "docs", "API.md"), "utf8");
      apiDocsCache = mdToHtml(raw.replace(/<BASE_URL>/g, config.baseUrl));
    } catch {
      apiDocsCache = "<p class='muted'>API reference not found on this deployment.</p>";
    }
  }
  res.send(V.apiDocsView(apiDocsCache));
});

// ---------- CRM / marketing sync (Phase 7.1) ----------
adminRouter.post("/crm", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  if (!(await ensureFeature(res, p.orgId, "crmSync", "CRM sync"))) return;
  const b = req.body || {};
  const name = clean(b.name);
  const provider = ["hubspot", "salesforce"].includes(b.provider) ? b.provider : "zapier";
  const endpoint = clean(b.endpoint); // zapier webhook URL
  const token = clean(b.token); // hubspot private-app token
  const sfOid = clean(b.sfOid); // salesforce org id (oid)
  const sfUrl = clean(b.sfUrl); // salesforce submission URL override (optional)
  if (!name) return res.redirect("/admin/integrations");
  if (provider === "zapier" && !endpoint) return res.redirect("/admin/integrations");
  if (provider === "hubspot" && !token) return res.redirect("/admin/integrations");
  if (provider === "salesforce" && !sfOid) return res.redirect("/admin/integrations");
  // SSRF guard on tenant-supplied outbound URLs (zapier endpoint, salesforce override).
  for (const candidate of [provider === "zapier" ? endpoint : "", provider === "salesforce" ? sfUrl : ""]) {
    if (candidate) {
      const chk = validateOutboundUrl(candidate);
      if (!chk.ok) return res.status(400).send(chk.error || "Invalid endpoint URL.");
    }
  }
  // Scope to a rooftop the admin can reach, or all rooftops in the org.
  let locationId: string | null = null;
  if (b.locationId) {
    const loc = await prisma.location.findFirst({ where: { id: String(b.locationId), orgId: p.orgId } });
    locationId = loc ? loc.id : null;
  }
  await prisma.crmIntegration.create({
    data: {
      orgId: p.orgId,
      provider,
      name,
      // endpoint = zapier webhook, or salesforce optional URL override (a URL,
      // not a secret — stored in the clear).
      endpoint: provider === "zapier" ? endpoint : provider === "salesforce" ? sfUrl || null : null,
      // token = hubspot token or salesforce oid — sealed at rest (see secretbox).
      // Guards above guarantee the relevant value is present for its provider.
      token:
        provider === "hubspot" && token
          ? seal(token)
          : provider === "salesforce" && sfOid
            ? seal(sfOid)
            : null,
      fieldMap: parseFieldMapLines(b.fieldMap) as any,
      locationId,
      enabled: true,
    },
  });
  audit(req, p, "crm.create", { targetType: "CrmIntegration", summary: `${provider}: ${name}` });
  res.redirect("/admin/integrations");
});

adminRouter.post("/crm/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await prisma.crmIntegration.deleteMany({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
  });
  audit(req, p, "crm.delete", { targetType: "CrmIntegration", targetId: req.params.id });
  res.redirect("/admin/integrations");
});

adminRouter.post("/crm/:id/test", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await sendTestSync(req.params.id, p.orgId);
  res.redirect("/admin/integrations");
});

adminRouter.post("/crm/logs/:id/retry", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await retrySync(req.params.id, p.orgId);
  res.redirect("/admin/integrations");
});

// ---------- marketing: GA/GTM tags + campaign short links (Phase 7.4) ----------
adminRouter.get("/marketing", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const [org, campaigns] = await Promise.all([
    prisma.org.findUnique({ where: { id: p.orgId }, select: { gaMeasurementId: true, gtmContainerId: true } }),
    prisma.campaign.findMany({ where: { orgId: p.orgId }, orderBy: { createdAt: "desc" } }),
  ]);
  res.send(V.marketingView({ org: org || {}, campaigns, baseUrl: config.baseUrl }));
});

adminRouter.post("/marketing/tags", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const ga = clean(req.body?.gaMeasurementId);
  const gtm = clean(req.body?.gtmContainerId);
  await prisma.org.update({
    where: { id: p.orgId },
    data: {
      gaMeasurementId: ga && isGaId(ga) ? ga : null,
      gtmContainerId: gtm && isGtmId(gtm) ? gtm : null,
    },
  });
  res.redirect("/admin/marketing");
});

adminRouter.post("/marketing/campaigns", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const b = req.body || {};
  const name = clean(b.name);
  const landingUrl = clean(b.landingUrl);
  if (!name || !landingUrl || !/^https?:\/\//i.test(landingUrl)) return res.redirect("/admin/marketing");
  let code = normalizeCampaignCode(b.code) || normalizeCampaignCode(name);
  if (!code) code = "c" + Math.random().toString(36).slice(2, 8);
  // Ensure the short code is globally unique.
  if (await prisma.campaign.findUnique({ where: { code } })) code = `${code}-${Math.random().toString(36).slice(2, 6)}`;
  await prisma.campaign.create({
    data: {
      orgId: p.orgId,
      code,
      name,
      landingUrl,
      utmSource: clean(b.utmSource) || null,
      utmMedium: clean(b.utmMedium) || null,
      utmCampaign: clean(b.utmCampaign) || null,
    },
  });
  res.redirect("/admin/marketing");
});

adminRouter.post("/marketing/campaigns/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await prisma.campaign.deleteMany({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
  });
  res.redirect("/admin/marketing");
});

adminRouter.post("/api-keys", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  if (!(await ensureFeature(res, p.orgId, "api", "API access"))) return;
  if (!(await canAdd(p.orgId, "apiKeys"))) return limitReached(res, "API key");
  const name = clean(req.body?.name) || "API key";
  const scopes = sanitizeScopes(asArray(req.body?.scopes));
  const { raw, hash, prefix } = generateApiKey();
  await prisma.apiKey.create({ data: { name, keyHash: hash, prefix, orgId: p.orgId, scopes } });
  audit(req, p, "apikey.create", { targetType: "ApiKey", summary: name });
  // Render directly (not a redirect) so the raw key never lands in a URL/log.
  await renderIntegrations(res, p, raw);
});

adminRouter.post("/api-keys/:id/revoke", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  // updateMany scoped by org so an admin can't revoke another org's key.
  await prisma.apiKey.updateMany({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
    data: { revoked: true },
  });
  audit(req, p, "apikey.revoke", { targetType: "ApiKey", targetId: req.params.id });
  res.redirect("/admin/integrations");
});

adminRouter.post("/webhooks", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  if (!(await ensureFeature(res, p.orgId, "webhooks", "Webhooks"))) return;
  const url = clean(req.body?.url);
  if (!url) return res.redirect("/admin/integrations");
  const urlChk = validateOutboundUrl(url);
  if (!urlChk.ok) return res.status(400).send(urlChk.error || "Invalid webhook URL.");
  const events = asArray(req.body?.events).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  const secret = "whsec_" + crypto.randomBytes(24).toString("hex");
  await prisma.webhookEndpoint.create({
    // Signing secret sealed at rest; shown to the admin once via the redirect.
    data: { url, secret: seal(secret), events: events.length ? events : ["lead.captured"], orgId: p.orgId },
  });
  audit(req, p, "webhook.create", { targetType: "WebhookEndpoint", summary: url });
  // Render inline (not a redirect) so the one-time secret never lands in the
  // URL, browser history, or access logs.
  return renderIntegrations(res, p, null, null, secret);
});

adminRouter.post("/webhooks/:id/delete", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await prisma.webhookEndpoint.deleteMany({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
  });
  audit(req, p, "webhook.delete", { targetType: "WebhookEndpoint", targetId: req.params.id });
  res.redirect("/admin/integrations");
});

// Delivery inspector for one endpoint (org-scoped).
adminRouter.get("/webhooks/:id", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
  });
  if (!endpoint) return res.status(404).send("Webhook not found.");
  const filter = req.query.filter === "failed" ? "failed" : "all";
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpointId: endpoint.id, ...(filter === "failed" ? { success: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const flash =
    req.query.sent === "1" ? "Test event sent." : req.query.replayed === "1" ? "Delivery replayed." : null;
  res.send(V.webhookDetailView({ endpoint, deliveries, filter, flash }));
});

adminRouter.post("/webhooks/:id/test", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  await sendTestEvent(req.params.id, p.orgId);
  res.redirect(`/admin/webhooks/${req.params.id}?sent=1`);
});

adminRouter.post("/deliveries/:id/replay", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const d = await prisma.webhookDelivery.findFirst({
    where: RBAC.seesAllOrgs(p) ? { id: req.params.id } : { id: req.params.id, orgId: p.orgId },
    select: { endpointId: true, orgId: true },
  });
  if (!d) return res.status(404).send("Delivery not found.");
  await replayDelivery(req.params.id, d.orgId);
  res.redirect(`/admin/webhooks/${d.endpointId}?replayed=1`);
});

adminRouter.post("/scim-token/generate", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  if (!(await ensureFeature(res, p.orgId, "scim", "SCIM provisioning"))) return;
  const { raw, hash } = generateScimToken();
  await prisma.org.update({ where: { id: p.orgId }, data: { scimTokenHash: hash } });
  audit(req, p, "scim.token", { targetType: "Org", targetId: p.orgId });
  // Show the raw token once (never stored in plaintext / never in a URL).
  await renderIntegrations(res, p, null, raw);
});

adminRouter.post("/saml-config", async (req, res) => {
  const p = reqAdmin(req);
  if (!RBAC.canManageIntegrations(p)) return forbidden(res);
  const enabled = !!req.body?.enabled;
  // Turning SSO on requires a plan that includes it.
  if (enabled && !(await ensureFeature(res, p.orgId, "sso", "Single sign-on (SAML)"))) return;
  const entryPoint = clean(req.body?.entryPoint);
  const idpIssuer = clean(req.body?.idpIssuer);
  const idpCert = clean(req.body?.idpCert);
  if (enabled && (!entryPoint || !idpCert)) {
    return res.status(400).send("SAML sign-in needs an IdP SSO URL and signing certificate before it can be enabled.");
  }

  // Workspace address (needed for a stable ACS/reply URL). Normalize + validate.
  const subRaw = (clean(req.body?.subdomain) || "").toLowerCase();
  const subdomain = subRaw ? subRaw.replace(/[^a-z0-9-]/g, "") : null;
  if (subRaw && (!subdomain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(subdomain))) {
    return res.status(400).send("Subdomain may contain only letters, numbers and hyphens.");
  }
  const customDomain =
    (clean(req.body?.customDomain) || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;

  try {
    // Address is org-level; scoped to this admin's org.
    await prisma.org.update({ where: { id: p.orgId }, data: { subdomain, customDomain } });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return res.status(409).send("That subdomain or custom domain is already taken by another workspace.");
    }
    throw e;
  }

  const jitEnabled = !!req.body?.jitEnabled;
  await prisma.samlConfig.upsert({
    where: { orgId: p.orgId },
    create: { orgId: p.orgId, enabled, entryPoint, idpIssuer, idpCert, jitEnabled },
    update: { enabled, entryPoint, idpIssuer, idpCert, jitEnabled },
  });
  audit(req, p, "sso.update", {
    targetType: "SamlConfig",
    targetId: p.orgId,
    summary: `${enabled ? "enabled" : "disabled"}${jitEnabled ? ", JIT on" : ""}`,
  });
  res.redirect("/admin/integrations");
});

}
