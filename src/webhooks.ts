import { prisma } from "./db";
import { config } from "./config";
import { signBody, buildEnvelope, deliveryHeaders, truncate, pickHeaders } from "./webhook-core";

export const WEBHOOK_EVENTS = [
  "lead.captured",
  "card.created",
  "card.updated",
  "card.deleted",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

type Endpoint = { id: string; orgId: string; url: string; secret: string };

// Fire-and-forget: find active endpoints subscribed to `event` and deliver to each.
// Never throws into the caller (webhooks must not break the request).
export function emitEvent(event: WebhookEvent, data: unknown): void {
  (async () => {
    try {
      const endpoints = await prisma.webhookEndpoint.findMany({ where: { active: true } });
      for (const ep of endpoints) {
        const events = Array.isArray(ep.events) ? (ep.events as string[]) : [];
        // Build the envelope ONCE so retries resend an identical payload (stable
        // signature + a consistent idempotency basis for consumers).
        if (events.includes(event)) void deliver(ep, event, buildEnvelope(event, data), 1, true);
      }
    } catch {
      /* ignore */
    }
  })();
}

async function deliver(
  ep: Endpoint,
  event: string,
  body: string,
  attempt: number,
  autoRetry: boolean
): Promise<void> {
  const signature = signBody(ep.secret, body);
  const started = Date.now();
  try {
    const resp = await fetch(ep.url, {
      method: "POST",
      headers: deliveryHeaders(event, signature),
      body,
      signal: AbortSignal.timeout(8000),
    });
    const responseBody = truncate(await resp.text().catch(() => ""), 2000);
    await logDelivery({
      ep,
      event,
      attempt,
      success: resp.ok,
      statusCode: resp.status,
      durationMs: Date.now() - started,
      requestBody: body,
      signature,
      responseHeaders: pickHeaders(resp.headers as Iterable<[string, string]>),
      responseBody,
      error: resp.ok ? null : `HTTP ${resp.status}`,
    });
    if (!resp.ok && autoRetry && attempt < 3) scheduleRetry(ep, event, body, attempt);
  } catch (e: any) {
    await logDelivery({
      ep,
      event,
      attempt,
      success: false,
      statusCode: null,
      durationMs: Date.now() - started,
      requestBody: body,
      signature,
      responseHeaders: null,
      responseBody: null,
      error: String(e?.message || e).slice(0, 300),
    });
    if (autoRetry && attempt < 3) scheduleRetry(ep, event, body, attempt);
  }
}

function scheduleRetry(ep: Endpoint, event: string, body: string, attempt: number) {
  setTimeout(() => void deliver(ep, event, body, attempt + 1, true), attempt * 3000);
}

async function logDelivery(d: {
  ep: Endpoint;
  event: string;
  attempt: number;
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  requestBody: string;
  signature: string;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
  error: string | null;
}): Promise<void> {
  try {
    await prisma.webhookDelivery.create({
      data: {
        endpointId: d.ep.id,
        orgId: d.ep.orgId,
        event: d.event,
        attempt: d.attempt,
        success: d.success,
        statusCode: d.statusCode ?? null,
        durationMs: d.durationMs,
        requestBody: d.requestBody,
        signature: d.signature,
        responseHeaders: d.responseHeaders ?? undefined,
        responseBody: d.responseBody,
        error: d.error,
      },
    });
  } catch {
    /* ignore */
  }
}

// ---- manual actions (inspector) ----

// Re-send an existing delivery's exact payload (single shot, no auto-retry).
// Org-scoped so an admin can't replay another tenant's delivery.
export async function replayDelivery(deliveryId: string, orgId: string): Promise<boolean> {
  const d = await prisma.webhookDelivery.findFirst({
    where: { id: deliveryId, orgId },
    include: { endpoint: true },
  });
  if (!d || !d.endpoint || !d.requestBody) return false;
  const ep = d.endpoint;
  void deliver({ id: ep.id, orgId: ep.orgId, url: ep.url, secret: ep.secret }, d.event, d.requestBody, 1, false);
  return true;
}

// Send a synthetic `ping` to an endpoint so integrators can confirm connectivity.
export async function sendTestEvent(endpointId: string, orgId: string): Promise<boolean> {
  const ep = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, orgId } });
  if (!ep) return false;
  const body = buildEnvelope("ping", { message: "OpenCard test event", endpointId: ep.id });
  void deliver({ id: ep.id, orgId: ep.orgId, url: ep.url, secret: ep.secret }, "ping", body, 1, false);
  return true;
}

// ---- Payload serializers (stable shapes for consumers) ----
export function cardPayload(card: any) {
  return {
    id: card.id,
    slug: card.slug,
    url: `${config.cardUrl}/c/${card.slug}`,
    prefix: card.prefix ?? null,
    firstName: card.firstName,
    lastName: card.lastName,
    fullName: [card.prefix, card.firstName, card.lastName].filter(Boolean).join(" "),
    title: card.title ?? null,
    department: card.department ?? null,
    company: card.company ?? null,
    ownerEmail: card.ownerEmail ?? null,
    locationId: card.locationId,
    active: card.active,
    showQr: card.showQr ?? null,
    phones: card.phones ?? [],
    emails: card.emails ?? [],
    websites: card.websites ?? [],
    socials: card.socials ?? [],
    updatedAt: card.updatedAt,
  };
}

export function leadPayload(lead: any, card: any) {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    company: lead.company ?? null,
    note: lead.note ?? null,
    createdAt: lead.createdAt,
    card: { id: card.id, slug: card.slug, fullName: [card.firstName, card.lastName].join(" ") },
  };
}
