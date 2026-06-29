import crypto from "crypto";
import { prisma } from "./db";
import { config } from "./config";

export const WEBHOOK_EVENTS = [
  "lead.captured",
  "card.created",
  "card.updated",
  "card.deleted",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// Fire-and-forget: find active endpoints subscribed to `event` and deliver to each.
// Never throws into the caller (webhooks must not break the request).
export function emitEvent(event: WebhookEvent, data: unknown): void {
  (async () => {
    try {
      const endpoints = await prisma.webhookEndpoint.findMany({ where: { active: true } });
      for (const ep of endpoints) {
        const events = Array.isArray(ep.events) ? (ep.events as string[]) : [];
        if (events.includes(event)) void deliver(ep, event, data, 1);
      }
    } catch {
      /* ignore */
    }
  })();
}

async function deliver(
  ep: { id: string; url: string; secret: string },
  event: string,
  data: unknown,
  attempt: number
): Promise<void> {
  const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data });
  const signature = "sha256=" + crypto.createHmac("sha256", ep.secret).update(body).digest("hex");
  try {
    const resp = await fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "OpenCard-Webhooks/1",
        "X-OpenCard-Event": event,
        "X-OpenCard-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    await logDelivery(ep.id, event, resp.ok, resp.status, resp.ok ? null : `HTTP ${resp.status}`);
    if (!resp.ok && attempt < 3) scheduleRetry(ep, event, data, attempt);
  } catch (e: any) {
    await logDelivery(ep.id, event, false, null, String(e?.message || e).slice(0, 300));
    if (attempt < 3) scheduleRetry(ep, event, data, attempt);
  }
}

function scheduleRetry(ep: any, event: string, data: unknown, attempt: number) {
  setTimeout(() => void deliver(ep, event, data, attempt + 1), attempt * 3000);
}

async function logDelivery(
  endpointId: string,
  event: string,
  success: boolean,
  statusCode: number | null,
  error: string | null
): Promise<void> {
  try {
    await prisma.webhookDelivery.create({
      data: { endpointId, event, success, statusCode: statusCode ?? null, error },
    });
  } catch {
    /* ignore */
  }
}

// ---- Payload serializers (stable shapes for consumers) ----
export function cardPayload(card: any) {
  return {
    id: card.id,
    slug: card.slug,
    url: `${config.baseUrl}/c/${card.slug}`,
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
