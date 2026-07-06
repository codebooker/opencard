import { prisma } from "./db";
import { buildCrmPayload, nextSyncStatus, httpOk } from "./crmsync";
import { hubspotProperties, hubspotEmail, HUBSPOT_CONTACTS_URL, hubspotContactByEmailUrl } from "./hubspot";
import { salesforceBody, salesforceUrl } from "./salesforce";
import { assertPublicUrl } from "./ssrf";

// DB + HTTP side of CRM sync (the pure mapping/state logic lives in crmsync.ts).
// Fire-and-forget on capture; never throws into the caller.

async function httpSend(
  url: string,
  method: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 8000
): Promise<{ code: number | null; error: string | null }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    return { code: res.status, error: httpOk(res.status) ? null : `HTTP ${res.status}` };
  } catch (e: any) {
    return { code: null, error: String(e?.message || e).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

// Form-urlencoded POST (Salesforce Web-to-Lead).
async function httpForm(url: string, body: string, timeoutMs = 8000): Promise<{ code: number | null; error: string | null }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: ac.signal,
    });
    return { code: res.status, error: httpOk(res.status) ? null : `HTTP ${res.status}` };
  } catch (e: any) {
    return { code: null, error: String(e?.message || e).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

function ctxFromSource(source: { card?: any; asset?: any }, orgName: string | null) {
  const loc = source.card?.location || source.asset?.location;
  const sourceType: "card" | "asset" = source.card ? "card" : "asset";
  const sourceName = source.card
    ? [source.card.firstName, source.card.lastName].filter(Boolean).join(" ") || null
    : source.asset?.name || null;
  return { orgName, rooftop: loc?.name ?? null, sourceType, sourceName };
}

// One sync attempt of a lead to an integration, recording or updating a log.
async function attempt(
  integration: any,
  lead: any,
  ctx: { orgName: string | null; rooftop: string | null; sourceType: "card" | "asset"; sourceName: string | null },
  existing?: any
): Promise<void> {
  let code: number | null = null;
  let error: string | null = "not configured";
  if (integration.provider === "zapier") {
    if (integration.endpoint) {
      // Tenant-supplied URL — SSRF guard at send time (defeats DNS rebinding).
      const safe = await assertPublicUrl(integration.endpoint);
      if (!safe.ok) {
        error = `blocked: ${safe.error || "unsafe URL"}`;
      } else {
        const payload = buildCrmPayload(lead, ctx, integration.fieldMap);
        ({ code, error } = await httpSend(integration.endpoint, "POST", payload));
      }
    } else {
      error = "no webhook URL configured";
    }
  } else if (integration.provider === "hubspot") {
    if (!integration.token) {
      error = "no HubSpot token configured";
    } else {
      const props = hubspotProperties(lead, integration.fieldMap);
      const headers = { authorization: `Bearer ${integration.token}` };
      // Create the contact; if it already exists (409), update it by email.
      const created = await httpSend(HUBSPOT_CONTACTS_URL, "POST", { properties: props }, headers);
      const email = hubspotEmail(lead, props);
      if (created.code === 409 && email) {
        ({ code, error } = await httpSend(hubspotContactByEmailUrl(email), "PATCH", { properties: props }, headers));
      } else {
        ({ code, error } = created);
      }
    }
  } else if (integration.provider === "salesforce") {
    // Web-to-Lead: the org id (oid) is stored in `token`; `endpoint` optionally
    // overrides the submission URL (e.g. a sandbox host).
    if (!integration.token) {
      error = "no Salesforce Org ID (oid) configured";
    } else {
      const sfTarget = salesforceUrl(integration.endpoint);
      const safe = await assertPublicUrl(sfTarget);
      if (!safe.ok) {
        error = `blocked: ${safe.error || "unsafe URL"}`;
      } else {
        const body = salesforceBody(lead, integration.token, integration.fieldMap);
        ({ code, error } = await httpForm(sfTarget, body));
      }
    }
  } else {
    error = `provider "${integration.provider}" not yet supported`;
  }
  const ok = httpOk(code);
  const { status, attempts } = nextSyncStatus(existing?.attempts ?? 0, ok, integration.maxAttempts ?? 5);
  const data = { status, attempts, responseCode: code, lastError: ok ? null : error };
  if (existing) {
    await prisma.crmSyncLog.update({ where: { id: existing.id }, data });
  } else {
    await prisma.crmSyncLog.create({
      data: { orgId: integration.orgId, integrationId: integration.id, leadId: lead.id ?? "test", provider: integration.provider, ...data },
    });
  }
}

// Fire-and-forget: sync a captured lead to every matching enabled integration.
export function syncLeadToCrm(lead: any, source: { card?: any; asset?: any }): void {
  (async () => {
    try {
      const locId = source.card?.locationId || source.asset?.locationId || null;
      const integrations = await prisma.crmIntegration.findMany({
        where: { orgId: lead.orgId, enabled: true, OR: [{ locationId: null }, { locationId: locId }] },
      });
      if (!integrations.length) return;
      const org = await prisma.org.findUnique({ where: { id: lead.orgId }, select: { name: true } });
      const ctx = ctxFromSource(source, org?.name ?? null);
      for (const integ of integrations) await attempt(integ, lead, ctx);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ msg: "crm-sync-error", error: String(e?.message || e).slice(0, 200) }));
    }
  })();
}

// Admin "send test": run a sample lead through one integration (synchronous).
export async function sendTestSync(integrationId: string, orgId: string): Promise<void> {
  const integ = await prisma.crmIntegration.findFirst({ where: { id: integrationId, orgId } });
  if (!integ) return;
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
  const sample = {
    id: "test-" + Date.now().toString(36),
    name: "Test Lead",
    email: "test@example.com",
    phone: "555-0100",
    vehicleInterest: "Test Model",
    campaign: "test",
    status: "new",
    createdAt: new Date(),
  };
  await attempt(integ, sample, { orgName: org?.name ?? null, rooftop: null, sourceType: "card", sourceName: "Test Lead" });
}

// Manual retry of a failed sync log.
export async function retrySync(logId: string, orgId: string): Promise<void> {
  const log = await prisma.crmSyncLog.findFirst({ where: { id: logId, orgId }, include: { integration: true } });
  if (!log || !log.integration) return;
  const lead = await prisma.lead.findUnique({ where: { id: log.leadId } });
  let source: { card?: any; asset?: any } = {};
  if (lead?.cardId) source = { card: await prisma.card.findUnique({ where: { id: lead.cardId }, include: { location: true } }) };
  else if (lead?.assetId) source = { asset: await prisma.asset.findUnique({ where: { id: lead.assetId }, include: { location: true } }) };
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
  const ctx = ctxFromSource(source, org?.name ?? null);
  await attempt(log.integration, lead || { id: log.leadId, orgId }, ctx, log);
}
